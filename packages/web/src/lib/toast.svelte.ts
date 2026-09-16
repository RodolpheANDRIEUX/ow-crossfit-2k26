class Toasts {
  message = $state<string | null>(null);
  #timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, duration = 3200): void {
    this.message = message;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.message = null;
    }, duration);
  }
}

export const toast = new Toasts();
