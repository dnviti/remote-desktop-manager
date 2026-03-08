declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      sendMouseState(state: Mouse.State): void;
      sendKeyEvent(pressed: number, keysym: number): void;
      sendSize(width: number, height: number): void;
      createClipboardStream(mimetype: string): OutputStream;
      getDisplay(): Display;
      onstatechange: ((state: number) => void) | null;
      onerror: ((error: Status) => void) | null;
      onclipboard: ((stream: InputStream, mimetype: string) => void) | null;
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
        preventDefault(): void;
      }
    }

    class Mouse {
      constructor(element: HTMLElement);
      onEach(events: string[], handler: (e: Mouse.Event) => void): void;
    }

    class Keyboard {
      constructor(element: HTMLElement | Document);
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
      onkeydown: ((keysym: number) => boolean | void) | null;
      onkeyup: ((keysym: number) => void) | null;
      reset(): void;
    }

    class InputStream {
      index: number;
    }

    class OutputStream {
      index: number;
      onack: ((status: Status) => void) | null;
      sendBlob(data: string): void;
      sendEnd(): void;
    }

    class StringReader {
      constructor(stream: InputStream);
      ontext: ((text: string) => void) | null;
      onend: (() => void) | null;
    }

    class StringWriter {
      constructor(stream: OutputStream);
      sendText(text: string): void;
      sendEnd(): void;
      onack: ((status: Status) => void) | null;
    }
  }

  export default Guacamole;
}
