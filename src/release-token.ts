/**
 * Token for listing OpenTofu releases on github.com.
 *
 * The listing is public; a token only lifts the unauthenticated rate limit.
 * `GITHUB_DOT_COM_TOKEN` is the documented way to provide one. `GITHUB_TOKEN`
 * is used as a fallback only when the workflow itself runs on github.com — on
 * GitHub Enterprise that token belongs to a different server, and sending it to
 * github.com would both fail and disclose it.
 */
export function releaseToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.GITHUB_DOT_COM_TOKEN) return env.GITHUB_DOT_COM_TOKEN

  const server = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '')
  if (server === 'https://github.com' && env.GITHUB_TOKEN) return env.GITHUB_TOKEN

  return undefined
}
