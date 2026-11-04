// `docker run` commands as Compose services, and Compose services back as `docker run`.
import { dump, load } from 'js-yaml'
import { shellWords } from './curl.js'

// Flags that take a value, by every spelling docker accepts.
const FLAGS = {
  name: ['--name'],
  ports: ['-p', '--publish'],
  env: ['-e', '--env'],
  envFile: ['--env-file'],
  volumes: ['-v', '--volume'],
  mount: ['--mount'],
  network: ['--network', '--net'],
  networkAlias: ['--network-alias'],
  restart: ['--restart'],
  workdir: ['-w', '--workdir'],
  user: ['-u', '--user'],
  entrypoint: ['--entrypoint'],
  hostname: ['-h', '--hostname'],
  addHost: ['--add-host'],
  dns: ['--dns'],
  labels: ['-l', '--label'],
  capAdd: ['--cap-add'],
  capDrop: ['--cap-drop'],
  memory: ['-m', '--memory'],
  cpus: ['--cpus'],
  expose: ['--expose'],
  devices: ['--device'],
  tmpfs: ['--tmpfs'],
  platform: ['--platform'],
  pull: ['--pull'],
  shmSize: ['--shm-size'],
  securityOpt: ['--security-opt'],
  ulimit: ['--ulimit'],
  logDriver: ['--log-driver'],
  logOpt: ['--log-opt'],
  healthCmd: ['--health-cmd'],
  healthInterval: ['--health-interval'],
  healthTimeout: ['--health-timeout'],
  healthRetries: ['--health-retries'],
  healthStart: ['--health-start-period'],
  stopSignal: ['--stop-signal'],
  stopTimeout: ['--stop-timeout'],
  gpus: ['--gpus'],
  pid: ['--pid'],
  ipc: ['--ipc'],
  sysctl: ['--sysctl']
}
const SWITCHES = {
  detach: ['-d', '--detach'],
  remove: ['--rm'],
  interactive: ['-i', '--interactive'],
  tty: ['-t', '--tty'],
  privileged: ['--privileged'],
  init: ['--init'],
  readOnly: ['--read-only'],
  publishAll: ['-P', '--publish-all']
}
const FLAG_OF = new Map(Object.entries(FLAGS).flatMap(([key, names]) => names.map((name) => [name, key])))
const SWITCH_OF = new Map(Object.entries(SWITCHES).flatMap(([key, names]) => names.map((name) => [name, key])))

/** Splits text into separate `docker run` commands (newlines, `&&` and `;` between them). */
function commands(text) {
  const src = text.replace(/\\\r?\n/g, ' ')
  const parts = []
  let current = ''
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"') current += src[i++]
      current += c
    } else if (c === "'" || c === '"') {
      quote = c
      current += c
    } else if (c === '\n' || c === ';' || (c === '&' && src[i + 1] === '&')) {
      if (c === '&') i++
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part && !part.startsWith('#'))
}

/** One `docker run …` command as { image, command, options, switches, unknown }. */
export function parseDockerRun(text) {
  const words = shellWords(text)
  let i = 0
  if (words[i] === 'sudo') i++
  if (!/^(docker|podman)$/.test(words[i] ?? '')) throw new Error('Expected a command starting with docker run.')
  i++
  if (words[i] === 'container') i++
  if (words[i] !== 'run' && words[i] !== 'create') throw new Error('Only docker run and docker create are converted.')
  i++
  const options = {}
  const switches = new Set()
  const unknown = []
  while (i < words.length && words[i].startsWith('-')) {
    const word = words[i]
    const eq = word.startsWith('--') ? word.indexOf('=') : -1
    const flag = eq > 0 ? word.slice(0, eq) : word
    if (FLAG_OF.has(flag)) {
      const value = eq > 0 ? word.slice(eq + 1) : words[++i]
      if (value === undefined) throw new Error(`${flag} needs a value.`)
      ;(options[FLAG_OF.get(flag)] ??= []).push(value)
    } else if (SWITCH_OF.has(flag)) {
      switches.add(SWITCH_OF.get(flag))
    } else if (/^-[a-zA-Z]{2,}$/.test(flag) && [...flag.slice(1)].every((c) => SWITCH_OF.has(`-${c}`))) {
      // Bundled short switches such as -it or -dit.
      for (const c of flag.slice(1)) switches.add(SWITCH_OF.get(`-${c}`))
    } else {
      unknown.push(word)
    }
    i++
  }
  const image = words[i]
  if (!image) throw new Error('No image found after the options.')
  return { image, command: words.slice(i + 1), options, switches, unknown }
}

function serviceName(run, taken) {
  const base = (run.options.name?.[0] ?? run.image.split('/').pop().split(/[:@]/)[0]).toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'app'
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`
  taken.add(name)
  return name
}

function keyValues(list) {
  const out = {}
  for (const item of list) {
    const eq = item.indexOf('=')
    if (eq === -1) out[item] = null
    else out[item.slice(0, eq)] = item.slice(eq + 1)
  }
  return out
}

function toService(run) {
  const o = run.options
  const s = { image: run.image }
  const last = (key) => o[key]?.[o[key].length - 1]
  if (o.name) s.container_name = last('name')
  if (o.platform) s.platform = last('platform')
  if (o.hostname) s.hostname = last('hostname')
  if (o.entrypoint) s.entrypoint = last('entrypoint')
  if (run.command.length) s.command = run.command
  if (o.workdir) s.working_dir = last('workdir')
  if (o.user) s.user = last('user')
  if (o.restart) s.restart = last('restart')
  if (o.ports) s.ports = o.ports
  if (o.expose) s.expose = o.expose
  if (o.envFile) s.env_file = o.envFile
  if (o.env) s.environment = keyValues(o.env)
  // Compose resolves relative paths against the compose file, so $(pwd) becomes '.'.
  if (o.volumes || o.mount) s.volumes = [...(o.volumes ?? []), ...(o.mount ?? []).map(mountToVolume)].map((v) => v.replace(/^(\$\(pwd\)|\$\{?PWD\}?|`pwd`)(?=[:/])/, '.'))
  if (o.tmpfs) s.tmpfs = o.tmpfs
  if (o.network) {
    const net = last('network')
    if (['host', 'none'].includes(net) || net.startsWith('container:')) s.network_mode = net
    else if (net !== 'bridge' && net !== 'default') s.networks = o.networkAlias ? { [net]: { aliases: o.networkAlias } } : [net]
  }
  if (o.addHost) s.extra_hosts = o.addHost
  if (o.dns) s.dns = o.dns
  if (o.labels) s.labels = keyValues(o.labels)
  if (o.capAdd) s.cap_add = o.capAdd
  if (o.capDrop) s.cap_drop = o.capDrop
  if (o.devices) s.devices = o.devices
  if (o.securityOpt) s.security_opt = o.securityOpt
  if (o.sysctl) s.sysctls = keyValues(o.sysctl)
  if (o.ulimit) s.ulimits = Object.fromEntries(o.ulimit.map((item) => {
    const [name, limits] = item.split('=')
    const [soft, hard] = limits.split(':').map(Number)
    return [name, hard === undefined ? soft : { soft, hard }]
  }))
  if (o.memory) s.mem_limit = last('memory')
  if (o.cpus) s.cpus = Number(last('cpus'))
  if (o.shmSize) s.shm_size = last('shmSize')
  if (o.pid) s.pid = last('pid')
  if (o.ipc) s.ipc = last('ipc')
  if (o.pull) s.pull_policy = last('pull')
  if (o.stopSignal) s.stop_signal = last('stopSignal')
  if (o.stopTimeout) s.stop_grace_period = `${last('stopTimeout')}s`
  if (o.logDriver || o.logOpt) s.logging = { ...(o.logDriver ? { driver: last('logDriver') } : {}), ...(o.logOpt ? { options: keyValues(o.logOpt) } : {}) }
  if (o.healthCmd) {
    s.healthcheck = { test: ['CMD-SHELL', last('healthCmd')] }
    if (o.healthInterval) s.healthcheck.interval = last('healthInterval')
    if (o.healthTimeout) s.healthcheck.timeout = last('healthTimeout')
    if (o.healthRetries) s.healthcheck.retries = Number(last('healthRetries'))
    if (o.healthStart) s.healthcheck.start_period = last('healthStart')
  }
  if (o.gpus) {
    const value = last('gpus')
    const device = { driver: 'nvidia', capabilities: ['gpu'] }
    if (value === 'all') device.count = 'all'
    else if (/^\d+$/.test(value)) device.count = Number(value)
    else device.device_ids = value.replace(/^"?device=/, '').replace(/"$/, '').split(',')
    s.deploy = { resources: { reservations: { devices: [device] } } }
  }
  if (run.switches.has('privileged')) s.privileged = true
  if (run.switches.has('init')) s.init = true
  if (run.switches.has('readOnly')) s.read_only = true
  if (run.switches.has('interactive')) s.stdin_open = true
  if (run.switches.has('tty')) s.tty = true
  return s
}

// --mount type=bind,source=./data,target=/data,readonly → ./data:/data:ro
function mountToVolume(spec) {
  const parts = keyValues(spec.split(','))
  const source = parts.source ?? parts.src
  const target = parts.target ?? parts.destination ?? parts.dst
  if (!target) return spec
  const ro = 'readonly' in parts || 'ro' in parts ? ':ro' : ''
  return source ? `${source}:${target}${ro}` : target
}

/** Compose YAML for one or more `docker run` commands. */
export function runToCompose(text) {
  const runs = commands(text).map(parseDockerRun)
  if (!runs.length) throw new Error('Paste a docker run command.')
  const taken = new Set()
  const services = {}
  const notes = []
  const volumes = new Set()
  const networks = new Set()
  for (const run of runs) {
    const name = serviceName(run, taken)
    const service = toService(run)
    services[name] = service
    for (const volume of service.volumes ?? []) {
      const source = volume.split(':')[0]
      if (volume.includes(':') && /^[\w][\w.-]*$/.test(source)) volumes.add(source)
    }
    for (const net of Array.isArray(service.networks) ? service.networks : Object.keys(service.networks ?? {})) networks.add(net)
    if (run.switches.has('publishAll')) notes.push(`${name}: -P publishes every exposed port; list them under ports.`)
    if (run.unknown.length) notes.push(`${name}: not converted: ${run.unknown.join(' ')}`)
  }
  const doc = { services }
  if (volumes.size) doc.volumes = Object.fromEntries([...volumes].map((v) => [v, {}]))
  if (networks.size) doc.networks = Object.fromEntries([...networks].map((n) => [n, { external: true }]))
  const yaml = dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/: \{\}$/gm, ':')
  return { yaml, services: runs.length, notes }
}

const quote = (value) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`)

function entries(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  return Object.entries(value).map(([k, v]) => (v === null || v === undefined ? k : `${k}=${v}`))
}

/** `docker run` commands for each service of a Compose file. */
export function composeToRun(text) {
  let doc
  try {
    doc = load(text)
  } catch (error) {
    throw new Error(`Not valid YAML: ${error.reason ?? error.message}`)
  }
  const services = doc?.services
  if (!services || typeof services !== 'object') throw new Error('No services: section found.')
  const notes = []
  const out = Object.entries(services).map(([name, s]) => {
    if (!s.image) notes.push(`${name}: uses build:, so docker run needs an image built first.`)
    const args = ['docker', 'run', '-d', '--name', s.container_name ?? name]
    const add = (flag, list) => list.forEach((value) => args.push(flag, String(value)))
    if (s.restart && s.restart !== 'no') args.push('--restart', s.restart)
    add('-p', (s.ports ?? []).map((p) => (typeof p === 'object' ? `${p.published}:${p.target}${p.protocol && p.protocol !== 'tcp' ? `/${p.protocol}` : ''}` : p)))
    add('--env-file', [].concat(s.env_file ?? []).map((f) => (typeof f === 'object' ? f.path : f)))
    add('-e', entries(s.environment))
    add('-v', (s.volumes ?? []).map((v) => (typeof v === 'object' ? `${v.source ? `${v.source}:` : ''}${v.target}${v.read_only ? ':ro' : ''}` : v)))
    if (s.network_mode) args.push('--network', s.network_mode)
    else add('--network', Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {}))
    if (s.working_dir) args.push('-w', s.working_dir)
    if (s.user) args.push('-u', String(s.user))
    if (s.hostname) args.push('--hostname', s.hostname)
    add('--add-host', s.extra_hosts ?? [])
    add('-l', entries(s.labels))
    add('--cap-add', s.cap_add ?? [])
    add('--cap-drop', s.cap_drop ?? [])
    add('--device', s.devices ?? [])
    if (s.mem_limit) args.push('--memory', String(s.mem_limit))
    if (s.cpus) args.push('--cpus', String(s.cpus))
    if (s.privileged) args.push('--privileged')
    if (s.init) args.push('--init')
    if (s.read_only) args.push('--read-only')
    if (s.stdin_open) args.push('-i')
    if (s.tty) args.push('-t')
    if (s.entrypoint) args.push('--entrypoint', [].concat(s.entrypoint).join(' '))
    if (s.depends_on) notes.push(`${name}: depends_on has no docker run equivalent; start its dependencies first.`)
    args.push(s.image ?? `<${name}-image>`)
    if (s.command) args.push(...(Array.isArray(s.command) ? s.command.map(String) : shellWords(String(s.command))))
    return args.map(quote).join(' ')
  })
  return { commands: out.join('\n\n'), services: out.length, notes }
}
