type Handler<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    (this.handlers[type] ??= new Set()).add(handler);
    return () => this.handlers[type]?.delete(handler);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    this.handlers[type]?.forEach((h) => h(payload));
  }
}
