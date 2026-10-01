import { useEffect } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import LiveMap from './components/live/LiveMap'
import Upload from './components/Upload'
import Evidence from './components/Evidence'
import Foveation from './components/Foveation'
import Pipeline from './components/Pipeline'
import Footer from './components/Footer'
import { initApp } from './store/app'

export default function App() {
  useEffect(() => {
    void initApp()
  }, [])

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <LiveMap />
        <Upload />
        <Evidence />
        <Foveation />
        <Pipeline />
      </main>
      <Footer />
    </>
  )
}
