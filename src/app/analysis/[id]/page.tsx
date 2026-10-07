import { Workbench } from "@/components/Workbench";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Workbench view="analysis" id={(await params).id} />;
}
