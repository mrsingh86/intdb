export default function ChronicleRouteGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout bypasses the Orion shell - children render directly
  return <>{children}</>;
}
