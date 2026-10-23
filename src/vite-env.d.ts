/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface SpeechAlt {
  transcript: string;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: SpeechAlt;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}

interface SpeechErrorEvent {
  error?: string;
}

interface SpeechRec extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface ContactPick {
  name?: string[];
  tel?: string[];
  email?: string[];
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  }

  interface Navigator {
    contacts?: {
      select: (props: string[], options?: { multiple?: boolean }) => Promise<ContactPick[]>;
    };
  }
}

export {};
