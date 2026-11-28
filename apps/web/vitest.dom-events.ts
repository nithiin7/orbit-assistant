// Runs before anything loads react-dom, which picks animation event names when it loads. jsdom
// (31+) has `WebkitAnimation` styles but no `AnimationEvent`, so React would listen for
// `webkitAnimationEnd` and miss the `animationend` that browsers (and Testing Library) send.
if (!("AnimationEvent" in window)) {
  class AnimationEventShim extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  }
  Object.defineProperty(window, "AnimationEvent", {
    value: AnimationEventShim,
    configurable: true,
    writable: true,
  });
}
