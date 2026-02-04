import React from 'react';
import {
  Activity,
  Github,
  ShieldCheck,
  Clock,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { db } from '@/lib/db';
import { auth, signOut } from "@/auth";
import { LogOut, User as UserIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

function Tooltip({ children, text }: { children: React.ReactNode, text: string }) {
  return (
    <div className="group relative flex items-center gap-1 cursor-help">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-zinc-800 text-xs text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-zinc-700 shadow-xl z-50">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-700" />
      </div>
    </div>
  );
}

async function getRepos() {
  try {
    const snapshot = await db.collection('repositories').get();
    return {
      data: snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      error: null
    };
  } catch (err: any) {
    console.error('[Dashboard] Firestore Fetch Error:', err);
    return {
      data: [],
      error: err.message || 'Failed to connect to Firestore'
    };
  }
}

async function getUserLink(email: string | null | undefined) {
  if (!email) return null;
  try {
    const doc = await db.collection('users').doc(email).get();
    if (doc.exists) {
      return doc.data();
    }
  } catch (err) {
    console.error('[Dashboard] User Fetch Error:', err);
  }
  return null;
}

export default async function Dashboard() {
  const session = await auth();
  const [reposResult, userLink] = await Promise.all([
    getRepos(),
    getUserLink(session?.user?.email)
  ]);
  const { data: repos, error } = reposResult;

  const totalUnblocks = repos.reduce((acc, repo: any) => acc + (repo.unblocks || 0), 0);
  const stagnantCount = repos.filter((r: any) => r.status === 'STAGNANT_PLANNING').length;
  const activeCount = repos.filter((r: any) => r.status === 'ACTIVE' || r.status === 'COMPLETE').length;

  return (
    <div className="min-h-screen bg-[#050505] text-white p-8">
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-10 h-10 text-cyan-400" />
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Momentum Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm">
            <Zap size={16} />
            <span>Agent Live</span>
          </div>

          {session?.user && (
            <div className="flex items-center gap-4 pl-4 border-l border-white/10">
              <div className="flex items-center gap-2">
                {session.user.image ? (
                  <img src={session.user.image} alt="User" className="w-8 h-8 rounded-full border border-white/20" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-white/10">
                    <UserIcon size={16} className="text-zinc-400" />
                  </div>
                )}
                <div className="hidden sm:block">
                  <p className="text-xs font-bold leading-none flex items-center gap-2">
                    {session.user.name}
                    {userLink && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 rounded border border-indigo-500/30 flex items-center gap-1">
                        <MessageSquare size={10} />
                        Linked
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-zinc-500">{session.user.email}</p>
                </div>
              </div>

              <form action={async () => { "use server"; await signOut(); }}>
                <button type="submit" className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-all text-zinc-400 hover:text-white border border-zinc-700">
                  <LogOut size={16} />
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="glass-card p-6 flex flex-col gap-2">
          <Tooltip text="Cumulative Issues Created (Stagnation Unblocked)">
            <span className="text-zinc-400 text-sm font-medium border-b border-dashed border-zinc-700">Total Unblocks</span>
          </Tooltip>
          <div className="text-4xl font-bold">{totalUnblocks}</div>
          <div className="text-green-500 text-xs flex items-center gap-1">
            <Zap className="w-3 h-3" /> Live from Firestore
          </div>
        </div>
        <div className="glass-card p-6 flex flex-col gap-2">
          <Tooltip text="Tracked in Firestore Loop">
            <span className="text-zinc-400 text-sm font-medium border-b border-dashed border-zinc-700">Monitoring Repos</span>
          </Tooltip>
          <div className="text-4xl font-bold">{repos.length}</div>
          <div className="text-blue-500 text-xs flex items-center gap-1">
            <Github className="w-3 h-3" />
            <Tooltip text="Active = Proposal Accepted/Rejected (Handled)">
              <span className="font-bold">{activeCount} active</span>
            </Tooltip>
            ,
            <Tooltip text="Stagnant = Waiting for Bot Proposal">
              <span className="font-bold">{stagnantCount} stagnant</span>
            </Tooltip>
          </div>
        </div>
        <div className="glass-card p-6 flex flex-col gap-2">
          <span className="text-zinc-400 text-sm font-medium">Brain Model</span>
          <div className="text-4xl font-bold">Flash 3</div>
          <div className="text-cyan-500 text-xs flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Gemini 3.0 Experimental
          </div>
        </div>
      </div>

      {/* Repository List */}
      <div className="flex justify-between items-end mb-6">
        <h2 className="text-xl font-bold">Active Patrols</h2>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <RefreshCw className="w-4 h-4" />
          Auto-updates via Cloud
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {repos.length === 0 && !error && (
          <div className="glass-card p-12 text-center text-zinc-500 italic">
            No repositories being monitored yet. Use /momentum check in Discord to start!
          </div>
        )}
        {repos.map((repo: any) => (
          <div key={repo.id} className="glass-card p-6 flex items-center justify-between group hover:border-blue-500/50 transition-all duration-300">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${repo.status === 'STAGNANT_PLANNING' ? 'bg-orange-500/10 text-orange-500' : 'bg-green-500/10 text-green-500'}`}>
                {repo.status === 'STAGNANT_PLANNING' ? <AlertCircle className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg">{repo.repoRef}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${repo.status === 'STAGNANT_PLANNING' ? 'border-orange-500/30 text-orange-500 bg-orange-500/5' : 'border-green-500/30 text-green-500 bg-green-500/5'
                    }`}>
                    {repo.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <Tooltip text="Time since last commit (Raw Data)">
                    <span className="text-zinc-500 text-xs flex items-center gap-1 border-b border-dashed border-zinc-800 pb-0.5">
                      <Clock className="w-3 h-3" /> {repo.daysSince ? `${repo.daysSince} days stagnant` : 'Active'}
                    </span>
                  </Tooltip>
                  <span className="text-zinc-500 text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Status: {repo.status}
                  </span>
                  {repo.evaluation && (
                    <span className="text-cyan-400 text-xs font-bold flex items-center gap-1 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded">
                      <ShieldCheck className="w-3 h-3" /> Confidence: {repo.evaluation.score * 10}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {(repo.activeProposal || repo.lastProposal) && (
                <div className="hidden lg:block mr-8 text-right max-w-xs">
                  <span className="text-[10px] uppercase text-zinc-500 block mb-1">
                    {repo.status === 'COMPLETE' ? 'Issue Created' : 'Latest Proposal'}
                  </span>
                  <span className={`text-sm font-medium italic line-clamp-1 ${repo.status === 'COMPLETE' ? 'text-blue-200' : 'text-orange-200'}`}>
                    "{(repo.activeProposal || repo.lastProposal).description}"
                  </span>
                </div>
              )}
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {repo.issueUrl && (
                  <a
                    href={repo.issueUrl}
                    target="_blank"
                    className="px-4 py-2 h-10 bg-zinc-800 border border-zinc-700 rounded-lg flex items-center gap-2 hover:bg-zinc-700 transition-all text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Issue
                  </a>
                )}

                {repo.opikTraceId && (
                  <a
                    href={`https://www.comet.com/opik/momentum/projects/019bea25-bafb-7307-a1e8-bb3b9e911468/traces?traces_filters=${encodeURIComponent(JSON.stringify([{ field: "tags", operator: "contains", value: `cycle:${repo.opikTraceId}` }]))}`}
                    target="_blank"
                    className="px-4 py-2 h-10 bg-cyan-900/30 border border-cyan-500/30 text-cyan-400 rounded-lg flex items-center gap-2 hover:bg-cyan-900/50 transition-all text-sm"
                  >
                    <Activity className="w-4 h-4" />
                    View Patrol Cycle
                  </a>
                )}

                <a
                  href={repo.repoRef.startsWith('http') ? repo.repoRef : `https://github.com/${repo.repoRef}`}
                  target="_blank"
                  className="px-4 py-2 h-10 bg-blue-600 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 hover:bg-blue-500 hover:scale-105 transition-all flex items-center justify-center text-center"
                >
                  Details
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer / CTA */}
      <footer className="mt-20 border-t border-white/5 pt-8 flex justify-between items-center text-zinc-500">
        <p className="text-xs uppercase tracking-widest font-medium">Built for the Global Hackathon 2026</p>
        <div className="flex gap-8">
          <a href="#" className="text-xs uppercase tracking-widest font-medium hover:text-blue-400 transition-colors">Documentation</a>
          <a href="#" className="text-sm border border-zinc-700 px-3 py-1 rounded-md hover:bg-zinc-800 transition-all">Support</a>
        </div>
      </footer>
    </div>
  );
}
