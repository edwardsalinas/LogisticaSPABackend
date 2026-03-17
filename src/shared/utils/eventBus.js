const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }

  publish(eventName, payload) {
    console.log(`[EventBus] Publishing event: ${eventName}`, payload ? payload : '');
    this.emit(eventName, payload);
  }

  subscribe(eventName, listener) {
    this.on(eventName, async (payload) => {
      try {
        await listener(payload);
      } catch (error) {
        console.error(`[EventBus] Error in listener for event ${eventName}:`, error);
      }
    });
  }
}

const eventBusInstance = new EventBus();

module.exports = eventBusInstance;
