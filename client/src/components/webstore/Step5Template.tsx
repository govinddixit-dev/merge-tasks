import { Check } from "lucide-react";
import { TEMPLATES } from "./types";
import { useWebstore } from "./WebstoreContext";

export default function Step5Template() {
  const { state, set } = useWebstore();
  const { selectedTemplate } = state;

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Choose Template</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Select a layout style for your client's store</p>

      <div className="space-y-5">
        {TEMPLATES.map((t) => {
          const isSelected = selectedTemplate === t.id;
          return (
            <button
              key={t.id}
              className={`w-full text-left rounded-xl border-2 transition-all overflow-hidden ${isSelected ? "border-primary" : "border-mt-border hover:border-mt-border-2"}`}
              onClick={() => set("selectedTemplate", t.id)}
            >
              <div className="bg-[#F7F7F8] p-5 relative">
                {isSelected && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                    <Check size={12} color="#FFF" />
                  </div>
                )}
                {t.id === "classic" && (
                  <div className="flex gap-3 h-[140px]">
                    <div className="w-[60px] flex-shrink-0 rounded-md bg-[#E5E5E5] p-2 flex flex-col gap-2">
                      <div className="w-full h-3 rounded-sm bg-mt-border-2" />
                      {[1,2,3,4,5].map(i => <div key={i} className="w-full h-2 rounded-sm bg-[#DCDCDC]" />)}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="h-5 w-32 rounded-sm bg-mt-border-2" />
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        {[1,2,3,4,5,6].map(i => (
                          <div key={i} className="rounded-md bg-[#E5E5E5] flex flex-col items-center justify-center gap-1 p-2">
                            <div className="w-8 h-8 rounded bg-mt-border-2" />
                            <div className="w-full h-1.5 rounded-sm bg-mt-border-2" />
                            <div className="w-2/3 h-1.5 rounded-sm bg-[#DCDCDC]" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {t.id === "modern" && (
                  <div className="flex flex-col gap-2 h-[140px]">
                    <div className="h-12 rounded-md bg-[#E5E5E5] flex items-end p-2">
                      <div className="flex flex-col gap-1">
                        <div className="w-24 h-2.5 rounded-sm bg-mt-border-2" />
                        <div className="w-16 h-1.5 rounded-sm bg-[#DCDCDC]" />
                      </div>
                    </div>
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="rounded-md bg-[#E5E5E5] p-2 flex flex-col gap-1.5">
                          <div className="flex-1 rounded bg-mt-border-2" />
                          <div className="w-full h-1.5 rounded-sm bg-mt-border-2" />
                          <div className="w-2/3 h-1.5 rounded-sm bg-[#DCDCDC]" />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[1,2,3,4].map(i => <div key={i} className="h-6 rounded-md bg-[#E5E5E5]" />)}
                    </div>
                  </div>
                )}
                {t.id === "minimal" && (
                  <div className="flex flex-col gap-3 h-[140px] max-w-[280px] mx-auto">
                    <div className="flex items-center justify-between">
                      <div className="w-16 h-2.5 rounded-sm bg-mt-border-2" />
                      <div className="flex gap-3">
                        {[1,2,3].map(i => <div key={i} className="w-8 h-2 rounded-sm bg-[#DCDCDC]" />)}
                      </div>
                    </div>
                    <div className="flex-1 rounded-md bg-[#E5E5E5] flex items-center justify-center">
                      <div className="w-12 h-12 rounded bg-mt-border-2" />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-28 h-2.5 rounded-sm bg-mt-border-2" />
                      <div className="w-20 h-1.5 rounded-sm bg-[#DCDCDC]" />
                      <div className="w-16 h-5 rounded bg-mt-border-2 mt-1" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[15px] font-bold text-mt-ink">{t.name}</h3>
                  {isSelected && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mt-brand-light text-primary">Selected</span>}
                </div>
                <p className="text-[12px] text-mt-ink-3">{t.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
