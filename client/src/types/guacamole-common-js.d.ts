declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      sendMouseState(state: Mouse.State): void;
      sendKeyEvent(pressed: number, keysym: number): void;
      sendSize(width: number, height: number): void;
      getDisplay(): Display;
      onstatechange: ((state: number) => void) | null;
      onerror: ((error: Status) => void) | null;
    }

    class Display {
      getElement(): HTMLElement;
      getWidth(): number;
      getHeight(): number;
      scale(scale: number): void;
    }

    class Tunnel {
      state: number;
    }

    class WebSocketTunnel extends Tunnel {
      constructor(url: string);
    }

    class Status {
      code: number;
      message: string;
    }

    namespace Mouse {
      class State {
        x: number;
        y: number;
        left: boolean;
        middle: boolean;
        right: boolean;
        up: boolean;
        down: boolean;
      }

      class Event {
        state: State;
      }
    }

    class Mouse {
      constructor(element: HTMLElement);
      onEach(events: string[], handler: (e: Mouse.Event) => void): void;
    }

    class Keyboard {
      constructor(element: HTMLElement | Document);
      onkeydown: ((keysym: number) => boolean | void) | null;
      onkeyup: ((keysym: number) => void) | null;
      reset(): void;
    }
  }

  export default Guacamole;
}
