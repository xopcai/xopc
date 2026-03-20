declare module 'cli-table3' {
  const Table: new (options?: Record<string, unknown>) => {
    push: (...rows: unknown[]) => void;
    toString: () => string;
  };
  export default Table;
}
