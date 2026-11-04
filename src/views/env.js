import { ENV_TARGETS, looksSecret, readEnv, writeEnv } from '../tools/env.js'
import { errorText, field, h, hint, input, output, segmented, set, textarea } from '../ui.js'

export default {
  id: 'env',
  title: 'Env Variables',
  group: 'Convert',
  icon: 'sliders',
  color: '#eab308',
  description: '.env to JSON, Kubernetes Secret or ConfigMap, docker -e and back',
  keywords: ['env', 'dotenv', '.env', 'environment', 'variables', 'kubernetes', 'k8s', 'secret', 'configmap', 'docker', 'export', 'config'],
  create() {
    const source = textarea({ rows: 7, placeholder: 'DATABASE_URL=postgres://localhost/app\nAPI_KEY="abc 123"\n# comments are skipped' })
    const name = input({ value: 'app-env', 'aria-label': 'Resource name', class: 'mono' })
    const result = h('div', { class: 'result' })
    const out = output('Output')
    const target = segmented(ENV_TARGETS, 'json', () => update(), 'Output format')
    target.node.classList.add('chips-grid')
    const nameField = field('metadata.name', name)
    function update() {
      const kind = target.get()
      nameField.hidden = kind !== 'secret' && kind !== 'configmap'
      if (!source.value.trim()) return set(result, hint('Paste a .env file, a JSON object, a Kubernetes Secret or ConfigMap, or docker -e flags.'))
      try {
        const { pairs, from, name: readName } = readEnv(source.value)
        if (readName && name.value === 'app-env') name.value = readName
        out.node.querySelector('.block-head span').textContent = ENV_TARGETS.find(([k]) => k === kind)[1]
        out.set(writeEnv(pairs, kind, { name: name.value.trim() || 'app-env' }))
        const secrets = pairs.filter(([k]) => looksSecret(k)).map(([k]) => k)
        set(result,
          out.node,
          hint(`${pairs.length} variable${pairs.length === 1 ? '' : 's'} read from ${from}.`),
          kind === 'secret' ? hint('Secret data is only Base64-encoded, not encrypted. Keep real values out of git.') : null,
          secrets.length && kind !== 'secret' ? hint(`Looks secret: ${secrets.join(', ')}.`) : null)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', update)
    name.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('Input', source), field('Output', target.node), nameField, result),
      focus: source,
      fill(value) {
        source.value = value
        target.set(/^\s*(apiVersion|kind|\{)/m.test(value) ? 'dotenv' : 'json')
      }
    }
  }
}
