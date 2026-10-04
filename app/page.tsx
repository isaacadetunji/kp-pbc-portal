import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const { profile } = await getSession();
  if (!profile) redirect("/login");
  redirect(profile.app_role === "client" ? "/portal" : "/dashboard");
}
