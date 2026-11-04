import { composeToRun, runToCompose } from '../tools/docker.js'
import { errorText, field, h, hint, output, segmented, set, textarea } from '../ui.js'

const RUN_EXAMPLE = 'docker run -d --name db -p 5432:5432 \\\n  -e POSTGRES_PASSWORD=secret \\\n  -v pgdata:/var/lib/postgresql/data \\\n  --restart unless-stopped postgres:16'
const COMPOSE_EXAMPLE = 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"'

export default {
  id: 'docker',
  title: 'Docker run ↔ Compose',
  group: 'Convert',
  icon: 'container',
  color: '#2496ed',
  description: 'Turn docker run commands into a compose.yaml, or services back into docker run',
  keywords: ['docker', 'compose', 'docker-compose', 'container', 'podman', 'run', 'yaml', 'service'],
  create() {
    const source = textarea({ rows: 7, placeholder: RUN_EXAMPLE })
    const result = h('div', { class: 'result' })
    const out = output('compose.yaml')
    const direction = segmented([['toCompose', 'run → Compose'], ['toRun', 'Compose → run']], 'toCompose', (value) => {
      source.placeholder = value === 'toCompose' ? RUN_EXAMPLE : COMPOSE_EXAMPLE
      update()
    }, 'Direction')
    const title = out.node.querySelector('.block-head span')
    function update() {
      if (!source.value.trim()) {
        return set(result, hint(direction.get() === 'toCompose'
          ? 'Several commands, one per line or joined with &&, become several services. Named volumes and networks are declared at the end.'
          : 'Each service becomes one docker run command.'))
      }
      try {
        const converted = direction.get() === 'toCompose' ? runToCompose(source.value) : composeToRun(source.value)
        title.textContent = direction.get() === 'toCompose' ? 'compose.yaml' : 'docker run'
        out.set(converted.yaml ?? converted.commands)
        set(result, out.node, converted.notes.map((note) => hint(note)))
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, h('div', { class: 'bar' }, direction.node), field('Input', source), result),
      focus: source,
      fill(value) {
        source.value = value
        direction.set(/^\s*(sudo\s+)?(docker|podman)\s/.test(value) ? 'toCompose' : 'toRun')
      }
    }
  }
}
