import { Suspense } from "react";
import { Workbench } from "@/components/Workbench";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<p>正在讀取改寫工作區…</p>}>
      <Workbench view="rewrite" id={(await params).id} />
    </Suspense>
  );
}
