[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# tofu-validate action

A StepSecurity maintained drop-in replacement for
[dflook/tofu-validate](https://github.com/dflook/tofu-validate), with the same
inputs and outputs.

Checks an OpenTofu configuration for errors and annotates the offending lines, so
problems appear on the pull request diff rather than only in the job log. The
step fails when the configuration is not valid.

No backend is initialised and no state is read, so it is safe to run anywhere,
including on a fork's pull request.

## Usage

```yaml
name: Validate

on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Validate
        uses: step-security/tofu-validate@v3
        with:
          path: infra
```

To validate several modules, use a matrix:

```yaml
jobs:
  validate:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        path: [infra/network, infra/compute]
    steps:
      - uses: actions/checkout@v7

      - name: Validate
        uses: step-security/tofu-validate@v3
        with:
          path: ${{ matrix.path }}
```

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `path` | `.` | Directory holding the OpenTofu module to validate. |
| `workspace` | `default` | Workspace name made visible to the configuration. |
| `backend_config` | | Backend settings as `key=value`, one per line. Version discovery only. |
| `backend_config_file` | | Paths to backend config files, one per line. Version discovery only. |

### workspace

Validation evaluates `terraform.workspace`, so a configuration that branches on
it validates differently depending on the name:

```hcl
resource "aws_instance" "web" {
  count = terraform.workspace == "production" ? 3 : 1
}
```

The name is made visible to the configuration rather than selected, because no
backend is initialised and so there is no workspace to select. For the `remote`
and `cloud` backends it is forced to `default`, since the real workspace is
decided remotely and validating against a name that will not be used would be
misleading.

### The backend inputs

These configure nothing. Validation never initialises a backend, so they are read
only when the OpenTofu version has to be discovered from remote state. They are
accepted so the interface matches the sibling actions.

```yaml
        with:
          backend_config: token=${{ secrets.BACKEND_TOKEN }}
          backend_config_file: prod.backend.tfvars
```

## Outputs

| Name | Value |
| --- | --- |
| `failure_reason` | `validate-failed` when the configuration is not valid. |
| `failure-reason` | Hyphenated spelling of the same value. |

Both spellings are published, so either name works.

This is set **only** when the failure is an invalid configuration. A run that
fails for any other reason — the version could not be downloaded, the path does
not exist — fails without setting it, so
`failure-reason == 'validate-failed'` is a reliable test for a configuration
problem rather than for failure in general.

```yaml
      - name: Validate
        id: validate
        uses: step-security/tofu-validate@v3

      - name: Explain
        if: failure() && steps.validate.outputs.failure-reason == 'validate-failed'
        run: echo "Fix the errors annotated above"
```

## How it reports problems

Each diagnostic becomes a workflow annotation pointing at the exact position:

```
::error file=infra/main.tf,line=6,col=3,endLine=6,endColumn=16::Unsupported argument
```

Three details are worth knowing, because they look like omissions otherwise:

- **A diagnostic spanning several lines loses its column numbers.** GitHub
  rejects a column range across different lines by discarding the whole
  annotation, so the columns are dropped to keep the diagnostic.
- **Only the first line of each message is shown.** A workflow command is a
  single line; the full detail is in the log.
- **`Module not installed` is not reported.** Validation deliberately runs even
  when initialisation fails, and that diagnostic is usually a downstream effect
  of a real error reported elsewhere. Surfacing it would bury the actual cause.

`tofu init -backend=false` runs first, so providers are present and attribute
names can be checked. It is allowed to fail: a configuration broken enough to
fail initialisation is exactly the case worth describing, and stopping there
would replace useful diagnostics with a generic error.

If OpenTofu produces no readable report at all, the action falls back to plain
`tofu validate` and shows its output. That loses the annotations but not the
information.

## `.tofu` files

OpenTofu reads `.tofu` and `.tofu.json` files as well as `.tf` and `.tf.json`.
Where `main.tofu` and `main.tf` both exist, the `.tofu` file is used in place of
the `.tf` one. This applies to version discovery too: a `required_version` in
`main.tofu` replaces the one in `main.tf`.

## OpenTofu version

The version to run is worked out from your configuration, using the first of
these that applies:

1. a `required_version` constraint in the configuration
2. a `.tfswitchrc` file
3. an `.opentofu-version` file
4. a `.terraform-version` file
5. a `terraform` entry in `.tool-versions` (asdf), searching upwards to the workspace root
6. the `OPENTOFU_VERSION` environment variable (`TERRAFORM_VERSION` is also
   accepted, and wins if both are set)
7. the version recorded in local state, when state has been written
8. otherwise, the latest OpenTofu release

Configuration beats environment deliberately. `required_version` describes what
the code needs, so a workflow-wide `OPENTOFU_VERSION` default does not silently
override a module that pins something narrower.

Constraints that only Terraform releases before 1.6.0 can satisfy select
Terraform, since OpenTofu began as a fork of Terraform 1.6. Newer Terraform
releases are never considered. Downloads are compared against the published
`SHA256SUMS` before being extracted.

Validation is version sensitive: an argument valid in one provider version may
not be in another, so pin the version if you want stable results.

## Environment variables

| Name | Purpose |
| --- | --- |
| `OPENTOFU_VERSION` | Version or constraint to run. See above for precedence. |
| `GITHUB_DOT_COM_TOKEN` | Token for github.com, used only to list OpenTofu releases. Without one the listing is unauthenticated and may be rate limited. On github.com itself `GITHUB_TOKEN` is used if this is not set; on GitHub Enterprise it is not, as that token belongs to another server. |
| `TERRAFORM_CLOUD_TOKENS` | `host=token` pairs, one per line, for the module registry. |
| `TERRAFORM_HTTP_CREDENTIALS` | `host=user:password` pairs, one per line, for fetching modules over HTTP or `git::https`. First match wins. |
| `TERRAFORM_SSH_KEY` | PEM-format private key for fetching modules over SSH. |
| `TERRAFORM_PRE_RUN` | Shell commands to run after OpenTofu is installed and before it is used. |

Credentials matter here even though no state is read: a module source may be
private, and validation has to install modules to check what they expose.

```yaml
      - name: Validate
        uses: step-security/tofu-validate@v3
        env:
          TERRAFORM_CLOUD_TOKENS: app.terraform.io=${{ secrets.TF_CLOUD_TOKEN }}
          TERRAFORM_SSH_KEY: ${{ secrets.TERRAFORM_SSH_KEY }}
```

## Development

Version resolution, downloading, initialisation and the diagnostic conversion are
shared with the sibling actions through
[`dflook-terraform-actions-core`](https://github.com/step-security/dflook-terraform-actions-core),
included here as a submodule at `vendor/core`. The submodule is bundled into
`dist/` at build time, so consumers never need to fetch it.

```bash
git clone --recurse-submodules https://github.com/step-security/tofu-validate.git
npm ci
npm test
npm run build   # regenerates dist/, which is committed
```

An existing clone needs `git submodule update --init` once, or the build cannot
resolve `@core`.
