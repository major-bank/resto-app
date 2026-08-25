-- ============================================================
-- 云味小馆 · Supabase 初始化 SQL
-- 在 Supabase 控制台 → SQL Editor → New query 中执行一次即可
-- 作用：①创建数据表 resto_state（存整个业务 JSON）
--       ②放开 anon 读写（仅供后端服务使用）
--       ③创建公开图片桶 resto
-- ============================================================

-- ① 数据表（key-value：key='db' 存整个业务数据 JSON）
create table if not exists public.resto_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- ② 允许 anon key 读写（后端 server.js 使用；演示场景可接受）
alter table public.resto_state enable row level security;
drop policy if exists "anon_all" on public.resto_state;
create policy "anon_all" on public.resto_state
  for all using (true) with check (true);

-- ③ 公开图片桶（上传的菜品图通过公网 URL 直接访问）
insert into storage.buckets (id, name, public)
values ('resto', 'resto', true)
on conflict (id) do nothing;
