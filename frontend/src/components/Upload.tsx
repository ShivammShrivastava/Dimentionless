import { motion, AnimatePresence } from 'framer-motion'
import { useCallback, useRef, useState } from 'react'
import { uploadPointCloud } from '../lib/api'
import { decodeFrame } from '../lib/decode'
import { actions, useApp } from '../store/app'

const ease = [0.16, 1, 0.3, 1] as const

type UploadState = 'idle' | 'dragging' | 'uploading' | 'error'

const ACCEPT = '.bin,.pcd'

export default function Upload() {
  const uploadedFile = useApp(s => s.uploadedFile)
  const [state, setState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['bin', 'pcd'].includes(ext)) {
      setState('error')
      setError(`Unsupported format ".${ext}". Please use .bin or .pcd files.`)
      return
    }

    setState('uploading')
    setProgress(`Uploading ${file.name} (${(file.size / 1024).toFixed(0)} KB)…`)
    setError('')

    try {
      const buf = await uploadPointCloud(file)
      setProgress('Decoding and projecting onto grid…')
      const frame = decodeFrame(buf)

      // Inject into the store — this pushes it into the live map
      actions.injectUpload(frame, file.name)

      setState('idle')
      setProgress('')

      // Scroll to the live map so the user sees their data
      setTimeout(() => {
        document.getElementById('live')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (e) {
      setState('error')
      setError((e as Error).message || 'Upload failed')
      setProgress('')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('idle')
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('dragging')
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState('idle')
  }, [])

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }, [processFile])

  return (
    <section id="upload" className="section section--dark" data-theme="dark">
      <div className="container">
        <motion.div
          className="section__head"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, ease }}
        >
          <span className="eyebrow">Upload</span>
          <h2 className="h2">
            Try your <em>own</em> point cloud.
          </h2>
          <p className="lead">
            Upload a LiDAR scan (.bin or .pcd) and explore it on the interactive live map — top-down, 3D, or comparison view.
          </p>
        </motion.div>

        <motion.div
          className="upload"
          initial={{ opacity: 0, y: 40, scale: 0.985 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 1, ease }}
        >



          {/* Success banner: currently showing uploaded data */}
          <AnimatePresence>
            {uploadedFile && (
              <motion.div
                className="upload__active"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease }}
              >
                <div className="upload__active-content">
                  <div className="upload__active-left">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--lime)" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <b>Viewing your uploaded point cloud</b>
                      <span className="upload__filename">{uploadedFile}</span>
                    </div>
                  </div>
                  <div className="upload__active-actions">
                    <a className="btn btn--ghost" href="#live" style={{ padding: '9px 16px', fontSize: 13 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      View on map
                    </a>
                    <button
                      className="btn btn--ghost"
                      style={{ padding: '9px 16px', fontSize: 13 }}
                      onClick={() => actions.clearUpload()}
                    >
                      Resume playback
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className={`upload__dropzone ${state === 'dragging' ? 'is-dragging' : ''} ${state === 'uploading' ? 'is-uploading' : ''} ${state === 'error' ? 'is-error' : ''} ${uploadedFile ? 'is-done' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => state !== 'uploading' && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileSelect}
              className="upload__input"
              id="upload-input"
              aria-label="Upload a LiDAR point cloud file"
            />

            <AnimatePresence mode="wait">
              {(state === 'idle' || state === 'dragging') && (
                <motion.div
                  key="idle"
                  className="upload__idle"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <div className="upload__icon">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <rect x="4" y="4" width="40" height="40" rx="12" fill="none" stroke="url(#upload-grad)" strokeWidth="1.5" strokeDasharray="4 4" />
                      <path d="M24 32V18M24 18l-6 6M24 18l6 6" stroke="url(#upload-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <defs>
                        <linearGradient id="upload-grad" x1="4" y1="4" x2="44" y2="44">
                          <stop stopColor="#D4FC79" />
                          <stop offset="1" stopColor="#FF6B9D" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div className="upload__text">
                    <b>{state === 'dragging' ? 'Drop it here!' : uploadedFile ? 'Upload another point cloud' : 'Drag & drop your point cloud'}</b>
                    <span>or click to browse · {uploadedFile ? 'replaces the current view' : 'opens in the live map above'}</span>
                  </div>
                  <div className="upload__formats">
                    <span className="upload__format-tag">.bin</span>
                    <span className="upload__format-sep">nuScenes / KITTI</span>
                    <span className="upload__format-tag">.pcd</span>
                    <span className="upload__format-sep">PCL format</span>
                  </div>
                </motion.div>
              )}

              {state === 'uploading' && (
                <motion.div
                  key="uploading"
                  className="upload__loading"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <div className="upload__spinner" />
                  <span>{progress}</span>
                </motion.div>
              )}

              {state === 'error' && (
                <motion.div
                  key="error"
                  className="upload__error-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6M9 9l6 6" />
                  </svg>
                  <b>{error}</b>
                  <button className="btn btn--ghost" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); setState('idle'); setError('') }}>
                    Try again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
