import { useState } from "react";
import { AdminToday } from '../lms/Dashboards';
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, GraduationCap, Sparkles, Users, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { useTerms } from "@/lib/terms";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Spinner,
  StatCard,
} from "@/components/ui";

interface DashboardData {
  students: number;
  teachers: number;
  sections: number;
  feeCollected: number;
  feeOutstanding: number;
  feeStatus: { payment_status: string; c: number }[];
  classDistribution: { name: string; students: number }[];
  recentStudents: {
    id: number;
    first_name: string;
    last_name: string;
    roll_no: string | null;
  }[];
  campuses: {
    id: number;
    name: string;
    code: string;
    is_main: boolean;
    students: number;
    staff: number;
    sections: number;
    attendance_rate: string | null;
    fee_collected: number;
    fee_outstanding: number;
  }[];
}

const PIE: Record<string, string> = {
  Paid: "var(--success)",
  Partial: "var(--warning)",
  Pending: "var(--danger)",
};
const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--fg)",
};

export function AdminDashboard() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const [campus, setCampus] = useState("");
  const q = useQuery({
    queryKey: ["institution-dashboard", campus],
    queryFn: () =>
      api.get<DashboardData>("/institution/dashboard", {
        campus_id: campus || undefined,
      }),
  });
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.get<{ done: boolean }>("/institution/onboarding"),
    enabled: can("settings.manage"),
    staleTime: 5 * 60 * 1000,
  });
  const [allCampuses, setAllCampuses] = useState<DashboardData["campuses"]>([]);
  if (q.data && !campus && q.data.campuses.length !== allCampuses.length)
    setAllCampuses(q.data.campuses);
  if (q.isPending) return <Spinner />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const campuses = campus ? allCampuses : d.campuses;
  const feePie = d.feeStatus.map((f) => ({
    name: t(`status.${f.payment_status}`, f.payment_status),
    key: f.payment_status,
    value: f.c,
  }));
  return (
    <>
      <PageHeader
        title={t("nav.dashboard", "Dashboard")}
        subtitle={t("admin.dashboardSubtitle", "Your institution at a glance")}
        actions={
          campuses.length > 1 && (
            <Select
              className="w-auto"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              aria-label={term("campus")}
            >
              <option value="">
                {t("dashboard.allCampuses", "All {{campuses}}", {
                  campuses: term("campus", true, { lower: true }),
                })}
              </option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      <AdminToday />
      {onboarding.data && !onboarding.data.done && (
        <Alert
          tone="info"
          className="mb-6"
          title={t("onboarding.bannerTitle", "Finish setting up")}
        >
          {t(
            "onboarding.banner",
            "A few minutes: your kind of institution, campuses, the year and terms, grading, then your people.",
          )}{" "}
          <Link to="/admin/setup">
            <Button size="sm" className="ms-2">
              <Sparkles className="size-4" />{" "}
              {t("onboarding.start", "Open the setup guide")}
            </Button>
          </Link>
        </Alert>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={term("student", true)}
          value={d.students}
          icon={Users}
        />
        <StatCard
          label={t("nav.staff", "Staff")}
          value={d.teachers}
          icon={GraduationCap}
          tone="warning"
        />
        <StatCard
          label={term("section", true)}
          value={d.sections}
          icon={BookOpen}
          tone="success"
        />
        <StatCard
          label={t("admin.feesCollected", "Fees collected")}
          value={formatMoney(d.feeCollected)}
          sub={t("admin.outstanding", "{{amount}} outstanding", {
            amount: formatMoney(d.feeOutstanding),
          })}
          icon={Wallet}
          tone="danger"
        />
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">
            {t("admin.feeStatus", "Fee status")}
          </h2>
          {feePie.length ? (
            <div dir="ltr" role="img" aria-label={feePie.map((e) => `${e.name}: ${e.value}`).join(', ')}>
              <div aria-hidden="true" {...{ inert: "" }}>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={feePie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {feePie.map((e) => (
                      <Cell
                        key={e.key}
                        fill={PIE[e.key] ?? "var(--fg-muted)"}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <EmptyState title={t("admin.noFees", "No fee records yet")} />
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">
            {t("admin.studentsBy", "{{students}} by {{section}}", {
              students: term("student", true),
              section: term("section", false, { lower: true }),
            })}
          </h2>
          {d.classDistribution.length ? (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={d.classDistribution}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: "var(--fg-muted)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: "var(--fg-muted)" }}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar
                    dataKey="students"
                    fill="var(--primary)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title={t("admin.noClasses", "No sections yet")} />
          )}
        </Card>
      </div>
      {!campus && campuses.length > 1 && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 font-semibold">
            {t("dashboard.compare", "Side by side")}
          </h2>
          <DataTable
            rows={campuses}
            rowKey={(c) => c.id}
            columns={[
              {
                key: "name",
                header: term("campus"),
                cell: (c) => (
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => setCampus(String(c.id))}
                  >
                    {c.name}
                  </button>
                ),
              },
              {
                key: "students",
                header: term("student", true),
                cell: (c) => c.students,
              },
              {
                key: "staff",
                header: t("nav.staff", "Staff"),
                cell: (c) => c.staff,
                hideOnMobile: true,
              },
              {
                key: "sections",
                header: term("section", true),
                cell: (c) => c.sections,
                hideOnMobile: true,
              },
              {
                key: "att",
                header: t("dashboard.attendance7", "Attendance (7 days)"),
                cell: (c) =>
                  c.attendance_rate == null ? "—" : `${c.attendance_rate}%`,
              },
              {
                key: "fees",
                header: t("admin.feesCollected", "Fees collected"),
                cell: (c) => formatMoney(c.fee_collected),
                hideOnMobile: true,
              },
              {
                key: "due",
                header: t("dashboard.outstanding", "Outstanding"),
                cell: (c) => formatMoney(c.fee_outstanding),
                hideOnMobile: true,
              },
            ]}
          />
        </Card>
      )}
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">
          {t("admin.recentAdmissions", "Recent admissions")}
        </h2>
        {d.recentStudents.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.recentStudents.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/admin/students/${s.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-surface-2"
                >
                  <div className="grid size-9 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                    {s.first_name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {s.first_name} {s.last_name}
                    </div>
                    <div className="text-xs text-fg-muted">{s.roll_no}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("admin.noStudents", "No students yet")} />
        )}
      </Card>
    </>
  );
}
