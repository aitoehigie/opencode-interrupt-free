import { InterruptPlugin } from 'opencode-plugin-interrupt'

export default InterruptPlugin({
  sensitivity: 'high',
  debug: true,
  correctionTriggers: ['my bad', 'scratch that'],
})
