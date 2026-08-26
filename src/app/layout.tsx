import type { Metadata } from "next";
import { cookies } from "next/headers";
import styles from "@/app/app-shell.module.scss";
import { ThemeProvider, type Theme } from "@/components/layout/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BASE_URL ?? "http://localhost:3005"),
  title: { default: "Ops", template: "%s · Ops" },
  description: "Production observability for registered services.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const theme: Theme =
    cookieStore.get("theme")?.value === "light" ? "light" : "dark";

  return (
    <html lang="en" data-theme={theme}>
      <body className={styles.body}>
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
