import { Workbench } from "@/components/Workbench";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Workbench view="review" id={(await params).id} />;
}
