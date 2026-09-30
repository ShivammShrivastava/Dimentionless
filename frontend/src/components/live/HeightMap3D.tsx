import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PALETTE_CB, PALETTE_DEFAULT, heightFactor } from '../../lib/colors'
import { useApp } from '../../store/app'

/**
 * 2.5D elevation columns: one InstancedMesh per ring, one box per occupied cell,
 * scaled to (cell, height, cell). Empty cells are simply not drawn.
 * three.js frame: X = -world y (right), Y = up, Z = -world x (forward = away).
 */
export default function HeightMap3D() {
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useApp(s => s.frame)
  const dense = useApp(s => s.dense)
  const settings = useApp(s => s.settings)
  const rings = useApp(s => s.rings)
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    meshes: THREE.InstancedMesh[]
    material: THREE.MeshStandardMaterial
    geometry: THREE.BoxGeometry
  } | null>(null)

  // scene setup (once)
  useEffect(() => {
    const el = wrap.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0f)
    scene.fog = new THREE.Fog(0x0d0d0f, 90, 260)

    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 600)
    camera.position.set(0, 95, 130)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = 1.5
    controls.minDistance = 6
    controls.maxDistance = 240
    controls.target.set(0, 0, -10)

    scene.add(new THREE.HemisphereLight(0xe9eef8, 0x0f172a, 0.95))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(30, 60, 20)
    scene.add(sun)

    const grid = new THREE.GridHelper(200, 40, 0x2a2a30, 0x1c1c20)
    grid.position.y = -0.02
    scene.add(grid)

    // ring outlines
    rings.forEach((r, k) => {
      const h = r.outer_m
      const pts = [new THREE.Vector3(-h, 0.02, -h), new THREE.Vector3(h, 0.02, -h), new THREE.Vector3(h, 0.02, h), new THREE.Vector3(-h, 0.02, h)]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: 0xd4fc79, transparent: true, opacity: 0.6 - k * 0.12 })
      scene.add(new THREE.LineLoop(geo, mat))
    })

    // ego
    const ego = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 4.6), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0x3a3a40, roughness: 0.4 }))
    ego.position.set(0, 0.65, 0)
    scene.add(ego)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff6b9d, emissiveIntensity: 0.5 }))
    nose.rotation.x = -Math.PI / 2
    nose.position.set(0, 0.9, -3.2)
    scene.add(nose)

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, wireframe: settings.wireframe })
    const meshes: THREE.InstancedMesh[] = []
    three.current = { renderer, scene, camera, controls, meshes, material, geometry }

    // camera fly-in
    const start = performance.now()
    const from = camera.position.clone()
    const to = new THREE.Vector3(0, 26, 40)
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = Math.min(1, (performance.now() - start) / 1500)
      if (t < 1) {
        const e = 1 - Math.pow(2, -10 * t)
        camera.position.lerpVectors(from, to, e)
      }
      controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      meshes.forEach(m => m.dispose())
      geometry.dispose()
      material.dispose()
      scene.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry && mesh !== (ego as THREE.Mesh)) mesh.geometry.dispose?.()
      })
      renderer.dispose()
      el.removeChild(renderer.domElement)
      three.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // instance update
  useEffect(() => {
    const T = three.current
    if (!T || !frame || !dense) return
    T.material.wireframe = settings.wireframe
    const palette = (settings.cbPalette ? PALETTE_CB : PALETTE_DEFAULT).map(h => new THREE.Color(h))
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const ex = settings.exaggeration

    frame.rings.forEach((r, k) => {
      const d = dense[k]
      const need = Math.max(1, r.n)
      let mesh = T.meshes[k]
      if (!mesh || (mesh.instanceMatrix.count as number) < need) {
        if (mesh) {
          T.scene.remove(mesh)
          mesh.dispose()
        }
        mesh = new THREE.InstancedMesh(T.geometry, T.material, Math.ceil(need * 1.4) + 500)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        T.meshes[k] = mesh
        T.scene.add(mesh)
      }
      const S = r.size
      const half = rings[k].outer_m
      const cell = r.cell_m
      let n = 0
      for (let t = 0; t < r.n; t++) {
        const p = r.idx[t]
        const label = d.label[p]
        if (label === 0 || !settings.layers[label]) continue
        if (d.conf[p] < settings.confMin) continue
        const i = (p / S) | 0
        const j = p - i * S
        const wx = -half + (i + 0.5) * cell
        const wy = -half + (j + 0.5) * cell
        const zMin = d.zMin[p] / 100
        const zMax = d.zMax[p] / 100
        const h = Math.max(0.04, (zMax - zMin) * ex)
        dummy.position.set(-wy, zMin * ex + h / 2, -wx)
        dummy.scale.set(cell * 0.96, h, cell * 0.96)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        color.copy(palette[label])
        if (settings.heightShade) color.multiplyScalar(heightFactor(d.zMax[p]) * 0.9)
        mesh.setColorAt(n, color)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [frame, dense, settings, rings])

  return <div ref={wrap} className="dash__view" style={{ cursor: 'grab' }} />
}
