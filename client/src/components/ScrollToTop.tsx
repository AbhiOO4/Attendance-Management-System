// components/ScrollToTop.tsx

import { useEffect } from "react"
import { useLocation } from "react-router-dom"

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    const container = document.getElementById(
      "main-scroll-container"
    )

    if (container) {
      container.scrollTo({
        top: 0,
      })
    }
  }, [pathname])

  return null
}

export default ScrollToTop