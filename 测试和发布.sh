# 测试：进入wsl，切换到这个目录
# node_modules 不能和 windows 混在一起了
npm install
openclaw plugins install .
openclaw plugins list

# 发布
# 1. 切回npm官方源（关键！必执行）
npm config set registry https://registry.npmjs.org/
# 2. 验证当前源，确认是官方地址
npm config get registry
# 3. 登录npm账号，按提示输入：npm账号 → 密码 → 邮箱验证码（npm会发验证码到注册邮箱）
npm login
# 4. 验证登录成功，会输出你的npm账号名
npm whoami

# 核心发布命令（公开发布，所有人可安装）
npm publish --access public