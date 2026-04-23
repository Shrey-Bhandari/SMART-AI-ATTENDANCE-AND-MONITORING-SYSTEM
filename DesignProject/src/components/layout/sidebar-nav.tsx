'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookCopy,
  ClipboardCheck,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Server,
  UserX,
  Users,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import { Icons } from '@/components/icons';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/live-cameras', icon: Video, label: 'Live Cameras' },
  { href: '/lectures', icon: BookCopy, label: 'Lectures' },
  { href: '/attendance', icon: ClipboardCheck, label: 'Attendance' },
  { href: '/students', icon: Users, label: 'Students' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/lecture-insights', icon: KeyRound, label: 'Lecture Insights' },
  { href: '/defaulters', icon: UserX, label: 'Defaulters' },
  { href: '/system-status', icon: Server, label: 'System Status' },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <>
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
          <Icons.logo className="h-7 w-7 text-primary-foreground" />
          <span className="text-lg font-semibold text-primary-foreground truncate">
            AI Classroom Watch
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="p-2">
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/')}
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Logout">
              <Link href="#">
                <LogOut />
                <span>Logout</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
