// Shapes returned by the backend API.

export type User = {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type ApiError = {
  error: string;
  details?: unknown;
};
