/**
 * A slightly naive iteration through the prototype of a constructor to mock out it's properties.
 *
 * This is to account for jest mocks not having an equivalent to sinon.createStubInstance.
 *
 * Based off of sinon's implementation:
 * https://github.com/sinonjs/sinon/blob/86088bd4dfd2376b16e82dcb3e42780238f3fc00/lib/sinon/stub-entire-object.js#L6
 */
export function createMockInstance<T>(
  ctor: new (...args: any[]) => T
): jest.Mocked<T> {
  const klass = Object.create(ctor.prototype);

  stubWalk(klass);
  maybeMakeObservable(klass, ctor);
  return klass as jest.Mocked<T>;

  function stubWalk(obj: object, context?: any, seen?: any) {
    if (obj === Object.prototype) {
      return;
    }

    seen = seen || {};
    context = context || obj;

    Object.getOwnPropertyNames(obj).forEach(function (prop) {
      if (!seen[prop]) {
        seen[prop] = true;

        // Skip getters as accessing them can error (e.g. when they're
        // `@mobx.computed`). We may need a better solution than this if we want
        // to fake getters/setters at some point in the future.
        const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
        if (
          prop !== 'constructor' &&
          descriptor &&
          typeof descriptor.value === 'function'
        ) {
          context[prop] = jest
            .fn()
            .mockName(`${klass.constructor.name}::${prop}`);
        }
      }
    });

    const proto = Object.getPrototypeOf(obj);
    if (proto) {
      stubWalk(proto, context, seen);
    }
  }
}

/**
 * If we are mocking a class that has observable properties, ensure those properties are observable
 * in our mock too.
 *
 * When a class is instantiated with the `new` keyword, `mobx.makeObservable` is called in the
 * constructor. When we make a mock instance the constructor is not invoked so the mock is not
 * observable.
 *
 * To work around this our MobX 6 decorators plugin stores observable metadata in a static
 * `_makeObservable` method on each class (for non-production builds). When we invoke that method on
 * our mock, the mock becomes observable.
 */
function maybeMakeObservable<T>(klass: any, ctor: new (...args: any[]) => T) {
  const proto = Object.getPrototypeOf(ctor);
  if (proto) {
    maybeMakeObservable(klass, proto);
  }

  (ctor as any)._makeObservable?.apply(undefined, [klass]);
}
