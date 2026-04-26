export type FeishuDocxTextElement = {
  text_run?: {
    content?: string;
    text_element_style?: Record<string, unknown>;
  };
};

export type FeishuBlockTable = {
  property?: {
    row_size?: number;
    column_size?: number;
    column_width?: number[];
  };
  cells?: string[];
  merge_info?: unknown;
};

export type FeishuDocxBlock = {
  block_id?: string;
  block_type: number;
  parent_id?: string;
  children?: string[] | string;
  text?: { elements?: FeishuDocxTextElement[] };
  table?: FeishuBlockTable;
  image?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FeishuDocxBlockChild = {
  block_id?: string;
  block_type?: number;
  parent_id?: string;
  children?: unknown;
  [key: string]: unknown;
};

export type FeishuDocxTextElement = {
  text_run?: {
    content?: string;
    text_element_style?: Record<string, unknown>;
  };
};

export type FeishuBlockTable = {
  property?: {
    row_size?: number;
    column_size?: number;
    column_width?: number[];
  };
  cells?: string[];
  merge_info?: unknown;
};

export type FeishuDocxBlock = {
  block_id?: string;
  block_type: number;
  parent_id?: string;
  children?: string[] | string;
  text?: { elements?: FeishuDocxTextElement[] };
  table?: FeishuBlockTable;
  image?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FeishuDocxBlockChild = {
  block_id?: string;
  block_type?: number;
  parent_id?: string;
  children?: unknown;
  [key: string]: unknown;
};

