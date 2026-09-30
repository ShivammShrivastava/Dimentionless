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
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1

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
    // fill light from the front-below for the car body
    const fill = new THREE.DirectionalLight(0xc8d8f0, 0.4)
    fill.position.set(-10, 3, -25)
    scene.add(fill)
    // rim light from behind
    const rim = new THREE.DirectionalLight(0xffd4e8, 0.3)
    rim.position.set(0, 8, 30)
    scene.add(rim)

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

    // ego vehicle – detailed 3D car matching the 2D TopDown glyph
    const egoGroup = new THREE.Group()

    // ----- body shell (rounded box using ExtrudeGeometry for realism) -----
    const bodyW = 1.9, bodyH = 1.1, bodyL = 4.6
    const bodyShape = new THREE.Shape()
    const br = 0.25 // corner radius
    bodyShape.moveTo(-bodyW / 2 + br, -bodyL / 2)
    bodyShape.lineTo(bodyW / 2 - br, -bodyL / 2)
    bodyShape.quadraticCurveTo(bodyW / 2, -bodyL / 2, bodyW / 2, -bodyL / 2 + br)
    bodyShape.lineTo(bodyW / 2, bodyL / 2 - br * 1.6)
    bodyShape.quadraticCurveTo(bodyW / 2, bodyL / 2, bodyW / 2 - br * 1.6, bodyL / 2)
    bodyShape.lineTo(-bodyW / 2 + br * 1.6, bodyL / 2)
    bodyShape.quadraticCurveTo(-bodyW / 2, bodyL / 2, -bodyW / 2, bodyL / 2 - br * 1.6)
    bodyShape.lineTo(-bodyW / 2, -bodyL / 2 + br)
    bodyShape.quadraticCurveTo(-bodyW / 2, -bodyL / 2, -bodyW / 2 + br, -bodyL / 2)

    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: bodyH, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3 })
    bodyGeo.rotateX(-Math.PI / 2) // lay flat
    bodyGeo.translate(0, bodyH, 0)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea, metalness: 0.35, roughness: 0.35,
      envMapIntensity: 1.2,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    egoGroup.add(bodyMesh)

    // ----- glass: windshield (front) -----
    const wsGeo = new THREE.BufferGeometry()
    const wsVerts = new Float32Array([
      -bodyW * 0.38, bodyH + 0.01, -bodyL * 0.22,
       bodyW * 0.38, bodyH + 0.01, -bodyL * 0.22,
       bodyW * 0.32, bodyH + 0.01, -bodyL * 0.06,
      -bodyW * 0.32, bodyH + 0.01, -bodyL * 0.06,
    ])
    wsGeo.setAttribute('position', new THREE.BufferAttribute(wsVerts, 3))
    wsGeo.setIndex([0, 1, 2, 0, 2, 3])
    wsGeo.computeVertexNormals()
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a22, metalness: 0.7, roughness: 0.15,
      transparent: true, opacity: 0.85,
    })
    egoGroup.add(new THREE.Mesh(wsGeo, glassMat))

    // ----- glass: rear window -----
    const rwGeo = new THREE.BufferGeometry()
    const rwVerts = new Float32Array([
      -bodyW * 0.33, bodyH + 0.01, bodyL * 0.24,
       bodyW * 0.33, bodyH + 0.01, bodyL * 0.24,
       bodyW * 0.38, bodyH + 0.01, bodyL * 0.36,
      -bodyW * 0.38, bodyH + 0.01, bodyL * 0.36,
    ])
    rwGeo.setAttribute('position', new THREE.BufferAttribute(rwVerts, 3))
    rwGeo.setIndex([0, 1, 2, 0, 2, 3])
    rwGeo.computeVertexNormals()
    egoGroup.add(new THREE.Mesh(rwGeo, glassMat))

    // ----- roof panel -----
    const roofGeo = new THREE.BoxGeometry(bodyW * 0.68, 0.06, bodyL * 0.3)
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.5, metalness: 0.15 })
    const roofMesh = new THREE.Mesh(roofGeo, roofMat)
    roofMesh.position.set(0, bodyH + 0.04, bodyL * 0.09)
    egoGroup.add(roofMesh)

    // slight raised cabin (gives 3D depth to the glass area)
    const cabinGeo = new THREE.BoxGeometry(bodyW * 0.7, 0.35, bodyL * 0.42)
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x2a2a32, metalness: 0.6, roughness: 0.2, transparent: true, opacity: 0.7 })
    const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat)
    cabinMesh.position.set(0, bodyH + 0.16, bodyL * 0.06)
    egoGroup.add(cabinMesh)

    // ----- wheels (4x) -----
    const wheelR = 0.32, wheelW2 = 0.18
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW2, 16)
    wheelGeo.rotateZ(Math.PI / 2)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.8, metalness: 0.1 })
    const wheelPositions: [number, number, number][] = [
      [-bodyW / 2 - 0.03, wheelR, -bodyL * 0.3],
      [bodyW / 2 + 0.03, wheelR, -bodyL * 0.3],
      [-bodyW / 2 - 0.03, wheelR, bodyL * 0.18],
      [bodyW / 2 + 0.03, wheelR, bodyL * 0.18],
    ]
    for (const pos of wheelPositions) {
      const w = new THREE.Mesh(wheelGeo, wheelMat)
      w.position.set(...pos)
      egoGroup.add(w)
      // hub cap (small shiny disc)
      const hubGeo = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, wheelW2 + 0.02, 12)
      hubGeo.rotateZ(Math.PI / 2)
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x555560, metalness: 0.8, roughness: 0.2 })
      const hub = new THREE.Mesh(hubGeo, hubMat)
      hub.position.set(...pos)
      egoGroup.add(hub)
    }

    // ----- side mirrors -----
    const mirrorGeo = new THREE.BoxGeometry(0.22, 0.12, 0.1)
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.5 })
    const mirrorL = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorL.position.set(-bodyW / 2 - 0.12, bodyH * 0.85, -bodyL * 0.2)
    egoGroup.add(mirrorL)
    const mirrorR = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorR.position.set(bodyW / 2 + 0.12, bodyH * 0.85, -bodyL * 0.2)
    egoGroup.add(mirrorR)

    // ----- headlights (lime, matching #D4FC79) -----
    const hlGeo = new THREE.BoxGeometry(bodyW * 0.22, 0.12, 0.08)
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xd4fc79, emissive: 0xd4fc79, emissiveIntensity: 0.8, roughness: 0.3 })
    const hlL = new THREE.Mesh(hlGeo, hlMat)
    hlL.position.set(-bodyW / 2 + bodyW * 0.19, bodyH * 0.55, -bodyL / 2 + 0.06)
    egoGroup.add(hlL)
    const hlR = new THREE.Mesh(hlGeo, hlMat)
    hlR.position.set(bodyW / 2 - bodyW * 0.19, bodyH * 0.55, -bodyL / 2 + 0.06)
    egoGroup.add(hlR)

    // headlight glow (point lights)
    const hlGlowL = new THREE.PointLight(0xd4fc79, 0.6, 8)
    hlGlowL.position.set(-bodyW * 0.3, bodyH * 0.55, -bodyL / 2 - 0.3)
    egoGroup.add(hlGlowL)
    const hlGlowR = new THREE.PointLight(0xd4fc79, 0.6, 8)
    hlGlowR.position.set(bodyW * 0.3, bodyH * 0.55, -bodyL / 2 - 0.3)
    egoGroup.add(hlGlowR)

    // ----- taillights (coral, matching #FF6B9D) -----
    const tlGeo = new THREE.BoxGeometry(bodyW * 0.22, 0.12, 0.08)
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff6b9d, emissiveIntensity: 0.6, roughness: 0.3 })
    const tlL = new THREE.Mesh(tlGeo, tlMat)
    tlL.position.set(-bodyW / 2 + bodyW * 0.19, bodyH * 0.55, bodyL / 2 - 0.06)
    egoGroup.add(tlL)
    const tlR = new THREE.Mesh(tlGeo, tlMat)
    tlR.position.set(bodyW / 2 - bodyW * 0.19, bodyH * 0.55, bodyL / 2 - 0.06)
    egoGroup.add(tlR)

    // ----- heading chevron (pink triangle pointing forward, like the 2D version) -----
    const chevGeo = new THREE.BufferGeometry()
    const chevH = 0.7
    const chevVerts = new Float32Array([
      0, bodyH * 0.5, -bodyL / 2 - chevH * 2,
      -bodyW * 0.28, bodyH * 0.5, -bodyL / 2 - 0.06,
       bodyW * 0.28, bodyH * 0.5, -bodyL / 2 - 0.06,
    ])
    chevGeo.setAttribute('position', new THREE.BufferAttribute(chevVerts, 3))
    chevGeo.computeVertexNormals()
    const chevMat = new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff6b9d, emissiveIntensity: 0.7, side: THREE.DoubleSide })
    egoGroup.add(new THREE.Mesh(chevGeo, chevMat))

    // ----- subtle ground shadow -----
    const shadowGeo = new THREE.PlaneGeometry(bodyW * 1.3, bodyL * 1.1)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    const shadow = new THREE.Mesh(shadowGeo, shadowMat)
    shadow.position.set(0, 0.01, 0)
    egoGroup.add(shadow)

    scene.add(egoGroup)
    const ego = egoGroup

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
        if (mesh.geometry) mesh.geometry.dispose?.()
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach(m => m.dispose?.())
        }
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
