// Tiny event bus. Later phases forward these events (collision, zone_enter, ...) to the gateway.
const handlers = new Map();

export const events = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  },
  emit(type, data) {
    const list = handlers.get(type);
    if (list) for (let i = 0; i < list.length; i++) list[i](data);
  },
};
