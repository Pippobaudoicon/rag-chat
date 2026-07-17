import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ChatLDS",
    short_name: "ChatLDS",
    description:
      "AI assistant grounded in LDS scriptures, conference talks, handbook and Liahona",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    categories: ["education", "utilities"],
    lang: "en-US",
    icons: [
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
