import { createCloudApp } from '../server/cloud-app.mjs';

const app = createCloudApp();
export default function handler(req, res) {
  // Vercel rewrites API paths to this single function.
  const url = new URL(req.url, 'https://frame.invalid');
  const route = url.searchParams.get('route');
  if (route !== null) {
    url.searchParams.delete('route');
    req.url = `/api/${route}${url.searchParams.size ? `?${url.searchParams}` : ''}`;
  }
  return app(req, res);
}
