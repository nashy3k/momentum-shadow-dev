'use client';

import React, { useState } from 'react';
import { MessageSquare, Send, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { submitPatronRequest } from '@/app/actions';

export default function RequestPatronage() {
    const [isOpen, setIsOpen] = useState(false);
    const [repoUrl, setRepoUrl] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Basic validation
        if (!repoUrl.includes('/')) {
            setStatus('error');
            setMessage('Please enter a valid owner/repo (e.g. facebook/react)');
            return;
        }

        setStatus('loading');
        try {
            const result = await submitPatronRequest(repoUrl);
            if (result.success) {
                setStatus('success');
                setMessage('Request sent! Our bot will alert the admin for approval.');
                setRepoUrl('');
                setTimeout(() => {
                    setIsOpen(false);
                    setStatus('idle');
                }, 3000);
            } else {
                setStatus('error');
                setMessage(result.error || 'Failed to submit request.');
            }
        } catch (err) {
            setStatus('error');
            setMessage('An unexpected error occurred.');
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20 font-bold text-sm"
            >
                <MessageSquare size={18} />
                Request Momentum
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#0a0a0a] border border-zinc-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-gradient-to-r from-indigo-950/20 to-transparent">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                                    <MessageSquare size={20} />
                                </div>
                                <h3 className="font-bold text-lg">Request Momentum</h3>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6">
                            <p className="text-sm text-zinc-400 mb-6">
                                Provide a public GitHub repository path (e.g. <code className="text-indigo-400">owner/repo</code>) to request an autonomous patrol cycle.
                            </p>

                            <div className="space-y-4">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={repoUrl}
                                        onChange={(e) => setRepoUrl(e.target.value)}
                                        placeholder="e.g. facebook/react"
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                                        required
                                        disabled={status === 'loading' || status === 'success'}
                                    />
                                </div>

                                {status === 'error' && (
                                    <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                                        <AlertCircle size={14} />
                                        <span>{message}</span>
                                    </div>
                                )}

                                {status === 'success' && (
                                    <div className="flex items-center gap-2 text-green-400 text-xs bg-green-500/10 p-3 rounded-lg border border-green-500/20">
                                        <CheckCircle2 size={14} />
                                        <span>{message}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={status === 'loading' || status === 'success'}
                                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${status === 'loading' || status === 'success'
                                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                                        }`}
                                >
                                    {status === 'loading' ? (
                                        'Sending...'
                                    ) : (
                                        <>
                                            <Send size={18} />
                                            Send Request
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
