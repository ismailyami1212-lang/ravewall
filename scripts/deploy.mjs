/**
 * Production deployment for RaveWall.
 *
 *   npm run deploy
 *
 * Deploys to the EXISTING Vercel project and then re-points the branded
 * production alias to the new deployment automatically — the bare
 * ravewall.vercel.app alias is assigned manually, so a plain `vercel deploy`
 * leaves it serving the previous build. This script makes the branded URL
 * always follow the latest production deployment.
 *
 * Steps: build check → deploy → alias set → health check.
 * No environment variables are created or modified; the old fallback alias
 * (kudos-testimonial-wall.vercel.app) keeps working because it is assigned to
 * the project, not to a deployment.
 */
import { execFileSync } from 'node:child_process'

const PROJECT_URL = 'https://ravewall.vercel.app'
const ALIAS = 'ravewall.vercel.app'

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  // `shell: true` so Windows resolves npx.cmd / curl.exe and POSIX resolves
  // them from PATH alike.
  return execFileSync(command, args, {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function main() {
  const deployOutput = run('npx', ['vercel', 'deploy', '--prod', '--yes'])
  process.stdout.write(deployOutput)

  // The deployment URL is the unique hash-style host the CLI prints. With a
  // piped stdio the "Production" prefix is omitted, so accept either form and
  // skip the project aliases.
  const urls = deployOutput.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? []
  const deploymentUrl = urls.find((url) => !/ravewall\.vercel\.app$/.test(url))
  if (!deploymentUrl) {
    console.error('Could not determine the production deployment URL from the CLI output.')
    process.exitCode = 1
    return
  }
  console.log(`\nProduction deployment: ${deploymentUrl}`)

  const aliasOutput = run('npx', ['vercel', 'alias', 'set', deploymentUrl, ALIAS])
  process.stdout.write(aliasOutput)
  console.log(`Alias ${ALIAS} now points to ${deploymentUrl}`)

  const health = run('curl', ['--noproxy', '*', '-s', `${PROJECT_URL}/api/health`])
  console.log(`\nHealth check: ${health.trim()}`)
  if (!health.includes('"status":"ok"')) {
    console.error('Health check did not report ok — investigate before announcing the deploy.')
    process.exitCode = 1
  }
}

main()
