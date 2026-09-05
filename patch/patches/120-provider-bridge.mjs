export default {
  id: "120-provider-bridge",
  description: "Expose provider settings and thread routing IPC",
  glob: ".vite/build/preload.js",
  marker: "__cxpProviders",
  apply(source) {
    return (
      source +
      `;(()=>{const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__cxpProviders',{call:(method,...args)=>{if(!['view','catalog','prepare','bind','route','native-selected','save','remove','select','discover','usage','native-select','refresh-registry'].includes(method))throw Error('Invalid provider method');return ipcRenderer.invoke('codexpp:providers:'+method,...args)},onChange:fn=>{const cb=()=>fn();ipcRenderer.on('codexpp:providers-changed',cb);return()=>ipcRenderer.removeListener('codexpp:providers-changed',cb)},onNativeSelect:fn=>{const cb=(_,data)=>fn(data);ipcRenderer.on('codexpp:provider-native-select',cb);return()=>ipcRenderer.removeListener('codexpp:provider-native-select',cb)}})})();`
    );
  },
};
