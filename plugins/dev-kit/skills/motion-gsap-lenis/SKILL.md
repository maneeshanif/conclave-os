---
name: motion-gsap-lenis
description: "Use when a page or concept needs motion: scroll-driven reveals, pinned sections, smooth scrolling. How to use GSAP (with ScrollTrigger) and Lenis well, and how to keep it accessible and fast."
---

# Motion with GSAP and Lenis

Motion should explain the page, not decorate it. Use it to show order (what comes first), cause (this led to that) and focus (look here).

## The libraries

- **GSAP** with its **ScrollTrigger** plugin runs the animations. Register the plugin once: `gsap.registerPlugin(ScrollTrigger)`.
- **Lenis** gives smooth scrolling. Create one instance, tell ScrollTrigger about it (`lenis.on('scroll', ScrollTrigger.update)`) and drive it from GSAP's ticker (`gsap.ticker.add((t) => lenis.raf(t * 1000))`, then `gsap.ticker.lagSmoothing(0)`).
- Check the current documentation for both before you use an API; versions change.

## How to build it

1. **Start from a page that works without any motion.** Content readable, links working, layout correct. Add motion on top.
2. **Animate transform and opacity only.** Not width, height, top or left: they force layout and stutter. Use `will-change: transform` sparingly, and remove it when done.
3. **One idea per section.** A reveal as content enters, a pinned section that steps through three states, a slow parallax on one image. Not all at once.
4. **Keep durations short** (0.3 to 0.8 seconds) with easing that settles (`power2.out`). Stagger lists by about 0.05 to 0.1 seconds.
5. **Clean up.** Kill ScrollTriggers and timelines when a section unmounts (`ctx.revert()` with `gsap.context`).

## Accessibility and speed (not optional)

- **Respect `prefers-reduced-motion`.** When it is set, do not start Lenis, and show content in its final state with no scroll-driven animation. Test it.
- Never hide content behind an animation that may not run. Content starts visible, or is revealed by CSS that works without script.
- Keyboard and screen-reader users get the same content in the same order. Do not trap scroll, and never move focus because of an animation.
- Keep the page fast: lazy-load heavy media, and check the page still scrolls smoothly on a phone-sized screen.
- Nothing flashes more than three times a second.

## Your final note

Say which animations you added, where, and how you checked reduced motion.
