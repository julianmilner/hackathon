import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

// Exposes renderer statistics on window for profiling; costs nothing per frame.
export function DebugStats() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    window.__cityStats = () => ({ ...gl.info.memory, ...gl.info.render, programs: gl.info.programs?.length ?? 0 })
    return () => {
      delete window.__cityStats
    }
  }, [gl])
  return null
}
