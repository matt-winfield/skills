// The surface module of the meter's pointer targets: an unpainted region over the meter (and over
// its graph) that tells the hooks module when the pointer comes onto it, leaves it, or clicks it.
import type { ClientModule } from 'claude-code'

const REPEAT_MS = 50

const Hit: ClientModule<null, { isOver: boolean; isPressed?: boolean }> = (props, surface) => {
  surface.onPointer(event => {
    // A click is the left button let go over the region it went down on.
    if (event.type === 'down') {
      if (event.button === 'left') surface.setState({ isOver: true, isPressed: true })
      return
    }
    if (event.type === 'up') {
      // A region not laid out yet (0 by 0) says nothing of where the pointer is.
      const isInside = surface.columns === 0 || (event.x >= 0 && event.y >= 0 && event.x < surface.columns && event.y < surface.rows)
      if (surface.state?.isPressed && isInside) surface.post({ isOver: true, isClicked: true })
      surface.setState({ isOver: isInside })
      return
    }
    const isOver = event.type !== 'leave'
    surface.post({ isOver })
    if (isOver !== (surface.state?.isOver ?? false)) surface.setState({ isOver, isPressed: surface.state?.isPressed })
    // Going straight from the meter onto its graph, the leave and the enter post in one frame, and
    // the later replaces the other: the enter says so again a frame on.
    if (event.type === 'enter') {
      const stop = surface.every(REPEAT_MS, () => {
        stop()
        if (surface.state?.isOver) surface.post({ isOver: true })
      })
    }
  })
  const { Box } = surface.elements
  return <Box />
}

export default Hit
