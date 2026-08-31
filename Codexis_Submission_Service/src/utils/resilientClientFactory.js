import CircuitBreaker from 'opossum';

/**
 * Creates a circuit-breaker protected fetch client for a specific microservice.
 * 
 * @param {string} serviceName - Friendly name of the service (for logging)
 * @param {string} baseURL - The target URL of the microservice
 * @param {object} customOptions - Overrides for the Circuit Breaker config
 */
export const createResilientClient = (serviceName, baseURL, customOptions = {}) => {
  // 1. Define the generic fetch action
  const makeRequest = async ({ path, options = {} }) => {
    // Add default timeout using AbortController
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), options.timeout || 3000);
    
    try {
      const response = await fetch(`${baseURL}${path}`, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  };

  // 2. Configure the Circuit Breaker options
  const breakerOptions = {
    timeout: 4000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    volumeThreshold: 5,
    ...customOptions
  };

  // 3. Create the Circuit Breaker instance
  const breaker = new CircuitBreaker(makeRequest, breakerOptions);

  // 4. Define the Fallback: Throws an error immediately
  breaker.fallback((err) => {
    console.error(`[Circuit Breaker] ${serviceName} is offline. Failing request fast.`);
    throw new Error(`${serviceName.toUpperCase().replace(/\s+/g, '_')}_CIRCUIT_OPEN`);
  });

  // Log state changes
  breaker.on('open', () => console.error(`[Circuit Breaker] 🚨 ${serviceName} Circuit is OPEN!`));
  breaker.on('halfOpen', () => console.warn(`[Circuit Breaker] 🟡 ${serviceName} Circuit is HALF-OPEN.`));
  breaker.on('close', () => console.log(`[Circuit Breaker] ✅ ${serviceName} Circuit is CLOSED.`));

  // 5. Return the wrapped client interface
  return {
    fetch: async (path, options = {}) => {
      return await breaker.fire({ path, options });
    }
  };
};
