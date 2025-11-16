export * from './base';
export * from './wechat';
export * from './zhihu';
export * from './juejin';

import { registry } from './base';
import { wechatAdapter } from './wechat';
import { zhihuAdapter } from './zhihu';
import { juejinAdapter } from './juejin';

// 注册所有适配器
registry.register(wechatAdapter);
registry.register(zhihuAdapter);
registry.register(juejinAdapter);

// TODO: 其他平台适配器
// registry.register(csdnAdapter);
// registry.register(jianshuAdapter);
// registry.register(mediumAdapter);
// registry.register(toutiaoAdapter);
