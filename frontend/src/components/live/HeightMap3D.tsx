import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PALETTE_CB, PALETTE_DEFAULT, thermalColor } from '../../lib/colors'
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
    scene.background = new THREE.Color(0x060709)
    scene.fog = new THREE.Fog(0x060709, 100, 280)

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

    // ── ego vehicle: proper sedan silhouette ──────────────────────────────────
    const egoGroup = new THREE.Group()
    const BW = 1.9   // body width
    const BL = 4.6   // body length (Z axis in world, here mapped to Z in Three)
    // Materials
    const whiteMat  = new THREE.MeshStandardMaterial({ color: 0xf0f3f8, metalness: 0.28, roughness: 0.32 })
    const blackMat  = new THREE.MeshStandardMaterial({ color: 0x080a10, metalness: 0.45, roughness: 0.20, transparent: true, opacity: 0.95 })
    const darkMat   = new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.30, roughness: 0.50 })
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xaab4c8, metalness: 0.90, roughness: 0.12 })

    // ── 1. LOWER BODY using custom BufferGeometry for tapered sedan shape ─────
    //    Side profile (Z = forward = negative in Three.js Z):
    //    Hood rises from front  → roofline → trunk drops to rear
    //    Points: bottom-front, bottom-rear, top-front(hood), top-cabin-front,
    //            top-cabin-rear, top-rear(trunk)
    const hw = BW / 2
    // Z positions along length (Three Z, forward = negative)
    const zFront  = -BL / 2          // front bumper
    const zHoodT  = -BL * 0.18       // top of hood / base of windshield
    const zCabinF = -BL * 0.10       // windshield base (bottom)
    const zCabinR =  BL * 0.28       // rear window top
    const zTrunkT =  BL * 0.36       // trunk leading edge
    const zRear   =  BL / 2          // rear bumper
    // Y (height) at each station
    const yGround = 0.12             // tyre contact + clearance
    const yHood   = 0.70             // hood height
    const yCabF   = 1.10             // bottom of windshield
    const yCabTop = 1.65             // roof apex
    const yTrunk  = 0.85             // trunk height
    const yRear   = 0.65             // rear deck

    // Build left & right side panels as a thin extruded slab per side
    // Each side is a polygon (profile) extruded inward 0.06 m
    const makePanel = (xOuter: number, xInner: number) => {
      const verts = new Float32Array([
        // outer face (8 verts, polygon)
        xOuter, yGround, zFront,    // 0
        xOuter, yHood,   zFront,    // 1
        xOuter, yCabF,   zHoodT,    // 2
        xOuter, yCabTop, zCabinF,   // 3
        xOuter, yCabTop, zCabinR,   // 4
        xOuter, yTrunk,  zTrunkT,   // 5
        xOuter, yRear,   zRear,     // 6
        xOuter, yGround, zRear,     // 7
        // inner face (same, offset X)
        xInner, yGround, zFront,    // 8
        xInner, yHood,   zFront,    // 9
        xInner, yCabF,   zHoodT,    // 10
        xInner, yCabTop, zCabinF,   // 11
        xInner, yCabTop, zCabinR,   // 12
        xInner, yTrunk,  zTrunkT,   // 13
        xInner, yRear,   zRear,     // 14
        xInner, yGround, zRear,     // 15
      ])
      // Triangulate outer face (fan), inner face (fan reverse), side strips
      const idx: number[] = []
      // outer fan (0-7)
      for (let i = 1; i < 6; i++) idx.push(0, i, i + 1)
      idx.push(0, 6, 7)
      // inner fan (8-15) reversed winding
      for (let i = 9; i < 14; i++) idx.push(8, i + 1, i)
      idx.push(8, 15, 14)
      // side strips between outer and inner
      const pairs = [[0,8],[1,9],[2,10],[3,11],[4,12],[5,13],[6,14],[7,15],[0,8]]
      for (let s = 0; s < pairs.length - 1; s++) {
        const [a, b] = pairs[s]; const [c, d] = pairs[s + 1]
        idx.push(a, c, b); idx.push(b, c, d)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      return geo
    }
    egoGroup.add(new THREE.Mesh(makePanel(-hw, -hw + 0.06), whiteMat))   // left panel
    egoGroup.add(new THREE.Mesh(makePanel( hw - 0.06,  hw), whiteMat))   // right panel

    // ── 2. FLOOR / UNDERBODY ─────────────────────────────────────────────────
    const floorGeo = new THREE.BoxGeometry(BW - 0.12, 0.14, BL - 0.2)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.9, metalness: 0.1 })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.position.set(0, yGround + 0.07, 0)
    egoGroup.add(floorMesh)

    // ── 3. HOOD (front slab) ─────────────────────────────────────────────────
    const hoodGeo = new THREE.BoxGeometry(BW - 0.12, 0.06, BL * 0.28)
    const hoodMesh = new THREE.Mesh(hoodGeo, whiteMat)
    hoodMesh.position.set(0, yHood, zFront + BL * 0.14)
    hoodMesh.rotation.x = -0.14   // slight forward tilt
    egoGroup.add(hoodMesh)

    // ── 4. TRUNK (rear slab) ─────────────────────────────────────────────────
    const trunkGeo = new THREE.BoxGeometry(BW - 0.12, 0.06, BL * 0.18)
    const trunkMesh = new THREE.Mesh(trunkGeo, whiteMat)
    trunkMesh.position.set(0, yTrunk, zRear - BL * 0.09)
    trunkMesh.rotation.x = 0.12
    egoGroup.add(trunkMesh)

    // ── 5. ROOF ───────────────────────────────────────────────────────────────
    const roofGeo = new THREE.BoxGeometry(BW - 0.20, 0.06, BL * 0.36)
    const roofMesh = new THREE.Mesh(roofGeo, whiteMat)
    roofMesh.position.set(0, yCabTop + 0.03, (zCabinF + zCabinR) / 2)
    egoGroup.add(roofMesh)

    // ── 6. FRONT BUMPER ───────────────────────────────────────────────────────
    const fBumpGeo = new THREE.BoxGeometry(BW + 0.06, 0.22, 0.12)
    const fBumpMesh = new THREE.Mesh(fBumpGeo, chromeMat)
    fBumpMesh.position.set(0, yGround + 0.11, zFront + 0.06)
    egoGroup.add(fBumpMesh)

    // ── 7. REAR BUMPER ────────────────────────────────────────────────────────
    const rBumpGeo = new THREE.BoxGeometry(BW + 0.06, 0.22, 0.12)
    const rBumpMesh = new THREE.Mesh(rBumpGeo, chromeMat)
    rBumpMesh.position.set(0, yGround + 0.11, zRear - 0.06)
    egoGroup.add(rBumpMesh)

    // ── 8. WINDSHIELD (angled, black) ─────────────────────────────────────────
    const wsGeo = new THREE.BufferGeometry()
    wsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw * 0.84, yCabF,   zHoodT,   // bottom-left
       hw * 0.84, yCabF,   zHoodT,   // bottom-right
       hw * 0.76, yCabTop, zCabinF,  // top-right
      -hw * 0.76, yCabTop, zCabinF,  // top-left
    ]), 3))
    wsGeo.setIndex([0,1,2, 0,2,3])
    wsGeo.computeVertexNormals()
    egoGroup.add(new THREE.Mesh(wsGeo, blackMat))

    // ── 9. REAR WINDOW (angled, black) ────────────────────────────────────────
    const rwGeo2 = new THREE.BufferGeometry()
    rwGeo2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw * 0.76, yCabTop, zCabinR,   // top-left
       hw * 0.76, yCabTop, zCabinR,   // top-right
       hw * 0.84, yTrunk,  zTrunkT,   // bottom-right
      -hw * 0.84, yTrunk,  zTrunkT,   // bottom-left
    ]), 3))
    rwGeo2.setIndex([0,1,2, 0,2,3])
    rwGeo2.computeVertexNormals()
    egoGroup.add(new THREE.Mesh(rwGeo2, blackMat))

    // ── 10. SIDE WINDOWS (left & right) ───────────────────────────────────────
    const makeSideWindow = (x: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        x, yCabF + 0.05, zHoodT - 0.05,
        x, yCabTop - 0.04, zCabinF + 0.05,
        x, yCabTop - 0.04, zCabinR - 0.05,
        x, yTrunk + 0.05, zTrunkT + 0.05,
      ]), 3))
      g.setIndex([0,1,2, 0,2,3])
      g.computeVertexNormals()
      return g
    }
    egoGroup.add(new THREE.Mesh(makeSideWindow(-hw + 0.01), blackMat))
    egoGroup.add(new THREE.Mesh(makeSideWindow( hw - 0.01), blackMat))

    // ── 11. WHEELS (white rubber + dark hub) ──────────────────────────────────
    const wR = 0.32, wW = 0.20
    const wheelGeo = new THREE.CylinderGeometry(wR, wR, wW, 20)
    wheelGeo.rotateZ(Math.PI / 2)
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0xdde3ef, roughness: 0.6, metalness: 0.08 })
    const hubMat2  = new THREE.MeshStandardMaterial({ color: 0x444450, metalness: 0.85, roughness: 0.15 })
    const hubGeo2  = new THREE.CylinderGeometry(wR * 0.52, wR * 0.52, wW + 0.02, 14)
    hubGeo2.rotateZ(Math.PI / 2)
    const wheelPos: [number,number,number][] = [
      [-hw - 0.04, wR, -BL * 0.30],
      [ hw + 0.04, wR, -BL * 0.30],
      [-hw - 0.04, wR,  BL * 0.20],
      [ hw + 0.04, wR,  BL * 0.20],
    ]
    for (const pos of wheelPos) {
      const tw = new THREE.Mesh(wheelGeo, tyreMat); tw.position.set(...pos); egoGroup.add(tw)
      const hb = new THREE.Mesh(hubGeo2,  hubMat2);  hb.position.set(...pos); egoGroup.add(hb)
    }

    // ── 12. SIDE MIRRORS ──────────────────────────────────────────────────────
    const mGeo = new THREE.BoxGeometry(0.20, 0.10, 0.10)
    ;[-hw - 0.11, hw + 0.11].forEach((mx, i) => {
      const m = new THREE.Mesh(mGeo, darkMat)
      m.position.set(mx * (i === 0 ? 1 : 1), yCabF, zHoodT - 0.12)
      egoGroup.add(m)
    })

    // ── 13. HEADLIGHTS ────────────────────────────────────────────────────────
    const hlGeo = new THREE.BoxGeometry(BW * 0.22, 0.11, 0.07)
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xd4fc79, emissive: 0xd4fc79, emissiveIntensity: 1.0, roughness: 0.2 })
    ;[-hw * 0.62, hw * 0.62].forEach(hx => {
      const hl = new THREE.Mesh(hlGeo, hlMat); hl.position.set(hx, yHood * 0.65, zFront + 0.05); egoGroup.add(hl)
    })
    const hlGlL = new THREE.PointLight(0xd4fc79, 0.7, 9)
    hlGlL.position.set(-hw * 0.5, yHood * 0.65, zFront - 0.3)
    egoGroup.add(hlGlL)
    const hlGlR = new THREE.PointLight(0xd4fc79, 0.7, 9)
    hlGlR.position.set( hw * 0.5, yHood * 0.65, zFront - 0.3)
    egoGroup.add(hlGlR)

    // ── 14. TAILLIGHTS ────────────────────────────────────────────────────────
    const tlGeo = new THREE.BoxGeometry(BW * 0.22, 0.11, 0.07)
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff6b9d, emissiveIntensity: 0.8, roughness: 0.2 })
    ;[-hw * 0.62, hw * 0.62].forEach(tx => {
      const tl = new THREE.Mesh(tlGeo, tlMat); tl.position.set(tx, yRear * 0.9, zRear - 0.05); egoGroup.add(tl)
    })

    // ── 15. LiDAR SENSOR on roof ──────────────────────────────────────────────
    const lidarCZ = (zCabinF + zCabinR) / 2
    const lbGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.10, 20)
    const lbMat = new THREE.MeshStandardMaterial({ color: 0x6a7280, metalness: 0.7, roughness: 0.25 })
    const lb = new THREE.Mesh(lbGeo, lbMat); lb.position.set(0, yCabTop + 0.08, lidarCZ); egoGroup.add(lb)
    const ldGeo = new THREE.CylinderGeometry(0.20, 0.22, 0.22, 20)
    const ldMat = new THREE.MeshStandardMaterial({ color: 0xdde5f0, metalness: 0.5, roughness: 0.2 })
    const ld = new THREE.Mesh(ldGeo, ldMat); ld.position.set(0, yCabTop + 0.24, lidarCZ); egoGroup.add(ld)
    const ltGeo = new THREE.SphereGeometry(0.20, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    const ltMat = new THREE.MeshStandardMaterial({ color: 0xfafcff, metalness: 0.35, roughness: 0.15 })
    const lt = new THREE.Mesh(ltGeo, ltMat); lt.position.set(0, yCabTop + 0.35, lidarCZ); egoGroup.add(lt)
    const lidarLight = new THREE.PointLight(0x88aaff, 0.4, 4)
    lidarLight.position.set(0, yCabTop + 0.42, lidarCZ)
    egoGroup.add(lidarLight)

    // ── 16. SIDE SENSOR PODS (magenta) ────────────────────────────────────────
    const podGeo = new THREE.BoxGeometry(0.13, 0.09, 0.17)
    const podMat = new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff3377, emissiveIntensity: 0.4, roughness: 0.4 })
    const podPos: [number,number,number][] = [
      [-hw - 0.07, yHood * 0.8, -BL * 0.26], [ hw + 0.07, yHood * 0.8, -BL * 0.26],
      [-hw - 0.07, yHood * 0.8,  BL * 0.16], [ hw + 0.07, yHood * 0.8,  BL * 0.16],
    ]
    podPos.forEach(p => { const pod = new THREE.Mesh(podGeo, podMat); pod.position.set(...p); egoGroup.add(pod) })

    // ── 17. HEADING CHEVRON ───────────────────────────────────────────────────
    const chevGeo2 = new THREE.BufferGeometry()
    chevGeo2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0,      yHood * 0.5, zFront - 1.2,
     -hw * 0.5, yHood * 0.5, zFront - 0.05,
      hw * 0.5, yHood * 0.5, zFront - 0.05,
    ]), 3))
    chevGeo2.computeVertexNormals()
    egoGroup.add(new THREE.Mesh(chevGeo2, new THREE.MeshStandardMaterial({ color: 0xff6b9d, emissive: 0xff6b9d, emissiveIntensity: 0.9, side: THREE.DoubleSide })))

    // ── 18. GROUND SHADOW ─────────────────────────────────────────────────────
    const shadowGeo = new THREE.PlaneGeometry(BW * 1.4, BL * 1.1)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowMesh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.30 }))
    shadowMesh.position.set(0, 0.01, 0)
    egoGroup.add(shadowMesh)

    scene.add(egoGroup)

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.20, wireframe: settings.wireframe })
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
    // Class palette is still used for legend / layer toggles; but 3D coloring is thermal
    const classPalette = (settings.cbPalette ? PALETTE_CB : PALETTE_DEFAULT).map(h => new THREE.Color(h))
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

        if (label === 1) {
          // ── DRIVABLE ROAD: solid flat ground tile ───────────────────────
          // Position at ground level, thick enough to be clearly visible
          const roadH = 0.5
          dummy.position.set(-wy, roadH / 2, -wx)  // sit right on the ground plane
          dummy.scale.set(cell * 1.05, roadH, cell * 1.05)  // overlap cells so no gaps
          dummy.updateMatrix()
          mesh.setMatrixAt(n, dummy.matrix)

          // Saturated blue with distance-based brightness (like LiDAR intensity)
          const dist = Math.sqrt(wx * wx + wy * wy)
          const f = 0.5 + 0.5 * Math.min(1, dist / 50)
          color.setRGB(0.02 * f, 0.35 * f, 1.0 * f)
          mesh.setColorAt(n, color)
        } else {
          // ── ALL OTHER CLASSES: thermal height gradient ──────────────────
          const h = Math.max(0.04, (zMax - zMin) * ex)
          dummy.position.set(-wy, zMin * ex + h / 2, -wx)
          dummy.scale.set(cell * 0.96, h, cell * 0.96)
          dummy.updateMatrix()
          mesh.setMatrixAt(n, dummy.matrix)

          if (settings.heightShade) {
            const [tr, tg, tb] = thermalColor(d.zMax[p])
            color.setRGB(tr / 255, tg / 255, tb / 255)
          } else {
            color.copy(classPalette[label])
          }
          mesh.setColorAt(n, color)
        }
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [frame, dense, settings, rings])

  return <div ref={wrap} className="dash__view" style={{ cursor: 'grab' }} />
}
