export async function retry(operation, { attempts = 3, signal } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(attempt); } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
  }
}
