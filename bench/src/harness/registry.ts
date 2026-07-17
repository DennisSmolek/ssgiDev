export class Registry<T extends { id: string; label: string }> {
  private items = new Map<string, T>();
  private order: string[] = [];

  register(item: T): void {
    if (!this.items.has(item.id)) this.order.push(item.id);
    this.items.set(item.id, item);
  }

  get(id: string | null | undefined): T | undefined {
    if (!id) return undefined;
    return this.items.get(id);
  }

  list(): T[] {
    return this.order.map((id) => this.items.get(id)!) as T[];
  }

  first(): T {
    const id = this.order[0];
    if (!id) throw new Error('Registry is empty');
    return this.items.get(id)!;
  }

  // Resolves an id from URL param, falling back to the first registered item.
  resolve(id: string | null | undefined): T {
    return this.get(id) ?? this.first();
  }
}
