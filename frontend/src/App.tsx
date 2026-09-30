import { useEffect } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import Foveation from './components/Foveation'
import Pipeline from './components/Pipeline'
import LiveMap from './components/live/LiveMap'
import Evidence from './components/Evidence'
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
        <Foveation />
        <Pipeline />
        <LiveMap />
        <Evidence />
      </main>
      <Footer />
    </>
  )
}
