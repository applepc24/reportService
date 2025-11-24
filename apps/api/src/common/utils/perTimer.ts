export function perfTimer(tag: string) {
    const start = Date.now();
    return () => {
      const ms = Date.now() - start;
      console.log(`[PERF] ${tag} - ${ms}ms`);
      return ms;
    };
  }