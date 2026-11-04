import assert from 'node:assert/strict'
import { test } from 'node:test'

import { load } from 'js-yaml'
import { composeToRun, parseDockerRun, runToCompose } from '../../src/tools/docker.js'

test('docker run options become compose keys', () => {
  const { yaml, notes } = runToCompose(`docker run -d --name db -p 5432:5432 \\
    -e POSTGRES_PASSWORD=secret -e "POSTGRES_DB=app;x" \\
    -v pgdata:/var/lib/postgresql/data --restart=unless-stopped --memory 512m postgres:16`)
  const doc = load(yaml)
  assert.deepEqual(doc.services.db, {
    image: 'postgres:16',
    container_name: 'db',
    restart: 'unless-stopped',
    ports: ['5432:5432'],
    environment: { POSTGRES_PASSWORD: 'secret', POSTGRES_DB: 'app;x' },
    volumes: ['pgdata:/var/lib/postgresql/data'],
    mem_limit: '512m'
  })
  assert.deepEqual(doc.volumes, { pgdata: null })
  assert.deepEqual(notes, [])
})

test('several commands, bundled switches, bind mounts and commands', () => {
  const doc = load(runToCompose('docker run -it --rm --network mynet -v $(pwd)/src:/app -w /app node:20 npm test && podman run redis').yaml)
  assert.deepEqual(doc.services.node, { image: 'node:20', command: ['npm', 'test'], working_dir: '/app', volumes: ['./src:/app'], networks: ['mynet'], stdin_open: true, tty: true })
  assert.deepEqual(doc.services.redis, { image: 'redis' })
  assert.deepEqual(doc.networks, { mynet: { external: true } })
})

test('unknown flags are reported, not dropped silently', () => {
  assert.deepEqual(parseDockerRun('docker run --weird-flag nginx').unknown, ['--weird-flag'])
  assert.match(runToCompose('docker run --weird-flag nginx').notes[0], /--weird-flag/)
  assert.throws(() => parseDockerRun('kubectl run x'), /docker run/)
})

test('compose services become docker run commands', () => {
  const { commands } = composeToRun('services:\n  web:\n    image: nginx\n    ports: ["80:80"]\n    environment:\n      A: 1\n    command: nginx -g "daemon off;"\n')
  assert.equal(commands, "docker run -d --name web -p 80:80 -e A=1 nginx nginx -g 'daemon off;'")
})
