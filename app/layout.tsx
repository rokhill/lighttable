import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LightTable — share your table",
  description:
    "A community cookbook on LCAI. Share recipes, tip the cooks you love, and let on-chain AI adapt anything to your kitchen.",
};

// Set the theme class before paint to avoid a flash. Respects a saved choice,
// else falls back to the OS setting.
const themeBootstrap = `
(function(){
  try {
    var saved = localStorage.getItem('lt-theme');
    var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = saved ? saved === 'dark' : sysDark;
    document.documentElement.classList.toggle('dark', dark);
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
