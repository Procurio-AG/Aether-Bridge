import { memo, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';

interface SourceEditorProps {
    defaultValue: string;
    onChange: (value: string) => void;
}

/**
 * Isolated Source Editor component to prevent re-renders in the parent 'App' 
 * from causing layout/measurement glitches in Monaco.
 */
export const SourceEditor = memo(({ defaultValue, onChange }: SourceEditorProps) => {
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Debounce the change event to ensure smooth typing while allowing the compiler to stay up to date.
    const handleEditorChange = (value: string | undefined) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        
        timerRef.current = setTimeout(() => {
            onChange(value || "");
        }, 300); // 300ms delay to keep the local Monaco instance fluid
    };

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const handleEditorDidMount = (editor: any, monaco: any) => {
        monaco.editor.defineTheme('clay-light', {
            base: 'vs',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '999da0', fontStyle: 'italic' },
                { token: 'keyword', foreground: '4c645b', fontStyle: 'bold' },
                { token: 'string', foreground: '65597c' },
                { token: 'number', foreground: 'a83836' },
                { token: 'type', foreground: '50616d' },
            ],
            colors: {
                'editor.background': '#f6fafd00', // Transparent to show container
                'editor.lineHighlightBackground': '#e7eff466',
                'editorLineNumber.foreground': '#56616644',
                'editorLineNumber.activeForeground': '#4c645b',
                'editorIndentGuide.background': '#dfe1e5',
                'editorIndentGuide.activeBackground': '#4c645b88',
                'editor.selectionBackground': '#cde9dc88',
            }
        });
        monaco.editor.setTheme('clay-light');
    };

    return (
        <Editor
            height="100%"
            defaultLanguage="javascript" // Aether-lang closer to JS syntax for highlighting
            theme="clay-light"
            defaultValue={defaultValue}
            onMount={handleEditorDidMount}
            onChange={handleEditorChange}
            options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "'Lexend', sans-serif",
                fontLigatures: true,
                lineHeight: 24,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                cursorSmoothCaretAnimation: "on",
                cursorBlinking: "smooth",
                renderLineHighlight: "all",
                selectionHighlight: true,
                // Critical: Force Monaco to monitor its own container size for resizing consistency.
                automaticLayout: true, 
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                },
                guides: {
                    indentation: true,
                },
                wordWrap: "on",
            }}
        />
    );
});
